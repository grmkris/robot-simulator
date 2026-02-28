/**
 * Match lifecycle orchestrator — HTTP Agent API Edition (v4).
 *
 * v4 changes: Agent-controlled movement + knockback projectiles.
 * - driveForce, turnRate, shoot fields in AgentAction
 * - Shoot flag consumed after one tick (fire-once semantics)
 * - Projectiles in game state, viewer broadcasts, and replay frames
 * - Expanded tactical context (facing angles, cooldowns, incoming projectiles)
 */
import { Simulation, GameLoop, initPhysics } from "@ai-arena/sim";
import type { ActionProvider } from "@ai-arena/sim";
import type {
  AgentAction,
  AgentId,
  MatchResult,
  WorldState,
  TacticalContext,
  GameStateResponse,
  ViewerProjectileState,
} from "@ai-arena/protocol";
import {
  ARENA_RADIUS,
  TICK_RATE,
  TICK_DURATION_S,
  MATCH_DURATION_S,
  VIEWER_BROADCAST_INTERVAL,
  AGENT_INACTIVITY_TIMEOUT_MS,
} from "@ai-arena/protocol";
import type { WSContext } from "hono/ws";
import {
  saveReplay,
  generateMatchId,
  type ViewerFrame,
} from "./replay-store.js";

const NO_OP: AgentAction = { leftArmTarget: 0, rightArmTarget: 0, driveForce: 0, turnRate: 0, shoot: false };

interface ConnectedAgent {
  /** Bearer token for HTTP auth */
  token: string;
  /** Display name */
  name: string;
  /** Persists between actions — the robot keeps doing this */
  confirmedAction: AgentAction;
  /** Timestamp of last poll (for inactivity detection) */
  lastPollTime: number;
  /** Tick when last action was submitted */
  lastActionTick: number;
  /** Public thought — visible to opponent + spectators */
  lastThought: string | null;
  /** Private thought — visible to spectators only */
  lastPrivateThought: string | null;
}

export class MatchManager {
  private agents = new Map<AgentId, ConnectedAgent>();
  private tokenToAgent = new Map<string, AgentId>();
  private sim: Simulation | null = null;
  private loop: GameLoop | null = null;
  private _currentState: WorldState | null = null;
  private spectators = new Set<WSContext>();
  private ticksSinceLastBroadcast = 0;
  private viewerFrameHistory: ViewerFrame[] = [];
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  /** Store last match result so agents can poll for it */
  private lastResult: MatchResult | null = null;

  get currentState(): WorldState | null {
    return this._currentState;
  }

  get agentCount(): number {
    return this.agents.size;
  }

  // ══════════════════════════════════════════
  // HTTP Agent API Methods
  // ══════════════════════════════════════════

  /** Register a new agent. Returns { agentId, token } or null if full. */
  assignAgent(name: string): { agentId: AgentId; token: string } | null {
    if (this.agents.size >= 2) return null;

    const id: AgentId = this.agents.has(0) ? 1 : 0;
    const token = crypto.randomUUID();

    this.agents.set(id, {
      token,
      name,
      confirmedAction: { ...NO_OP },
      lastPollTime: Date.now(),
      lastActionTick: 0,
      lastThought: null,
      lastPrivateThought: null,
    });
    this.tokenToAgent.set(token, id);

    console.log(`[Match] Agent "${name}" assigned as Robot ${id} (token=${token.slice(0, 8)}...)`);
    return { agentId: id, token };
  }

  /** Resolve a Bearer token to an AgentId (or null if invalid) */
  resolveToken(token: string): AgentId | null {
    return this.tokenToAgent.get(token) ?? null;
  }

  /** Build game state response for a specific agent */
  getGameStateForAgent(agentId: AgentId): GameStateResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return { status: "waiting" };

    // Update heartbeat
    agent.lastPollTime = Date.now();

    // No sim yet → waiting
    if (!this.sim || !this._currentState) {
      // Match finished (result stored but sim cleaned up)
      if (this.lastResult) {
        return {
          status: "finished",
          winner: this.lastResult.winner,
          reason: this.lastResult.reason,
          message:
            this.lastResult.winner === agentId
              ? "You won!"
              : this.lastResult.winner === null
                ? "Draw!"
                : "You lost.",
        };
      }
      return { status: "waiting" };
    }

    const state = this._currentState;

    // Countdown
    if (state.matchPhase === "countdown") {
      return {
        status: "countdown",
        tick: state.tick,
        elapsed: state.elapsed,
        you: agentId,
        matchPhase: state.matchPhase,
      };
    }

    // Active match — full state with tactical context
    const opponentId: AgentId = agentId === 0 ? 1 : 0;
    const opponent = this.agents.get(opponentId);
    const tactical = this.buildTacticalContext(state);

    return {
      status: "active",
      tick: state.tick,
      elapsed: state.elapsed,
      you: agentId,
      robots: state.robots,
      projectiles: state.projectiles,
      matchPhase: state.matchPhase,
      tactical: agentId === 0 ? tactical : this.flipTactical(tactical),
      yourLastAction: agent.confirmedAction,
      opponentLastThought: opponent?.lastThought ?? null,
    };
  }

  /** Receive an action from an agent via HTTP */
  receiveAction(agentId: AgentId, action: AgentAction): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Update confirmed action (persists until next submission)
    agent.confirmedAction = {
      leftArmTarget: action.leftArmTarget,
      rightArmTarget: action.rightArmTarget,
      driveForce: action.driveForce ?? 0,
      turnRate: action.turnRate ?? 0,
      shoot: action.shoot ?? false,
    };

    // Track thoughts
    agent.lastThought = action.thought ?? null;
    agent.lastPrivateThought = action.privateThought ?? null;

    // Track timing
    agent.lastActionTick = this._currentState?.tick ?? 0;
    agent.lastPollTime = Date.now(); // action counts as activity

    const thoughtPreview = agent.lastThought
      ? ` 💭 "${agent.lastThought.slice(0, 50)}"`
      : "";
    const movePreview = `drive=${(action.driveForce ?? 0).toFixed(2)} turn=${(action.turnRate ?? 0).toFixed(2)}${action.shoot ? " SHOOT" : ""}`;
    console.log(
      `[Match] Agent ${agentId} ("${agent.name}") action: L=${action.leftArmTarget.toFixed(2)} R=${action.rightArmTarget.toFixed(2)} ${movePreview}${thoughtPreview}`
    );
  }

  /** Handle voluntary agent leave (POST /api/leave) */
  handleAgentLeave(agentId: AgentId): void {
    const agent = this.agents.get(agentId);
    console.log(
      `[Match] Agent "${agent?.name}" (Robot ${agentId}) left`
    );

    // Clean up token mapping
    if (agent) {
      this.tokenToAgent.delete(agent.token);
    }
    this.agents.delete(agentId);

    if (this.sim && this.sim.phase === "active") {
      const winner: AgentId = agentId === 0 ? 1 : 0;
      this.handleMatchEnd({
        winner,
        reason: "disconnect",
        finalTick: this.sim.currentTick,
      });
    }
  }

  /** Start a match if both agents are connected */
  async tryStartMatch(): Promise<void> {
    if (this.agents.size < 2 || this.sim) return;

    const agent0 = this.agents.get(0);
    const agent1 = this.agents.get(1);
    console.log(
      `[Match] "${agent0?.name}" vs "${agent1?.name}" — Starting match...`
    );

    await initPhysics();
    this.sim = new Simulation();
    await this.sim.init();
    this.viewerFrameHistory = [];
    this.lastResult = null;

    // ACTION PERSISTENCE: return confirmedAction (never null)
    // SHOOT CONSUMPTION: shoot fires once then auto-resets to prevent multi-tick firing
    const actionProvider: ActionProvider = (
      agentId: AgentId,
      _state: WorldState
    ): AgentAction => {
      const agent = this.agents.get(agentId);
      if (!agent) return { ...NO_OP };
      const action = { ...agent.confirmedAction };
      // Consume shoot flag — fire exactly once per submission
      if (action.shoot) {
        agent.confirmedAction.shoot = false;
      }
      return action;
    };

    this.loop = new GameLoop(this.sim, actionProvider, {
      onTick: (state) => {
        this._currentState = state;

        // Capture viewer frame for replay (with thoughts)
        this.captureViewerFrame(state);

        // Throttle viewer broadcasts
        this.ticksSinceLastBroadcast++;
        if (this.ticksSinceLastBroadcast >= VIEWER_BROADCAST_INTERVAL) {
          this.broadcastToSpectators(state);
          this.ticksSinceLastBroadcast = 0;
        }
      },
      onMatchEnd: (result) => {
        this.handleMatchEnd(result);
      },
    });

    this.loop.start();

    // Start inactivity checker (1Hz)
    this.startInactivityChecker();
  }

  // ══════════════════════════════════════════
  // Spectator WebSocket (unchanged)
  // ══════════════════════════════════════════

  /** Add a spectator WebSocket */
  addSpectator(ws: WSContext): void {
    this.spectators.add(ws);
    console.log(
      `[Match] Spectator connected (total: ${this.spectators.size})`
    );

    // Send current state if available
    if (this._currentState) {
      try {
        const state = this._currentState;
        const r0 = state.robots[0];
        const r1 = state.robots[1];
        ws.send(
          JSON.stringify({
            type: "state",
            tick: state.tick,
            time: state.elapsed,
            robots: [
              this.buildViewerRobot("A", r0),
              this.buildViewerRobot("B", r1),
            ],
            matchPhase: state.matchPhase,
            projectiles: this.buildViewerProjectiles(state),
            ...this.buildThoughtsPayload(),
          })
        );
      } catch {
        // ignore
      }
    }
  }

  /** Remove a spectator WebSocket */
  removeSpectator(ws: WSContext): void {
    this.spectators.delete(ws);
    console.log(
      `[Match] Spectator disconnected (total: ${this.spectators.size})`
    );
  }

  // ══════════════════════════════════════════
  // Inactivity Detection
  // ══════════════════════════════════════════

  private startInactivityChecker(): void {
    this.inactivityTimer = setInterval(() => {
      if (!this.sim || this.sim.phase !== "active") return;

      const now = Date.now();
      for (const [id, agent] of this.agents) {
        const inactiveMs = now - agent.lastPollTime;
        if (inactiveMs > AGENT_INACTIVITY_TIMEOUT_MS) {
          console.log(
            `[Match] Agent ${id} ("${agent.name}") forfeited: inactive for ${(inactiveMs / 1000).toFixed(1)}s`
          );
          this.handleAgentLeave(id);
          return; // handleMatchEnd will clean up
        }
      }
    }, 1000); // Check every second
  }

  private stopInactivityChecker(): void {
    if (this.inactivityTimer) {
      clearInterval(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  // ══════════════════════════════════════════
  // Tactical Context
  // ══════════════════════════════════════════

  /** Extract facing angle (radians from +Z) from chassis quaternion */
  private getFacingAngle(rot: { x: number; y: number; z: number; w: number }): number {
    const fw_x = 2 * (rot.x * rot.z + rot.w * rot.y);
    const fw_z = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
    return Math.atan2(fw_x, fw_z);
  }

  /** Normalize angle to [-PI, PI] */
  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

  /** Build tactical context from robot 0's perspective */
  private buildTacticalContext(state: WorldState): TacticalContext {
    const r0 = state.robots[0];
    const r1 = state.robots[1];

    const dx = r1.chassis.position.x - r0.chassis.position.x;
    const dz = r1.chassis.position.z - r0.chassis.position.z;
    const distToOpponent = Math.hypot(dx, dz);

    const myDistFromCenter = Math.hypot(
      r0.chassis.position.x,
      r0.chassis.position.z
    );
    const opponentDistFromCenter = Math.hypot(
      r1.chassis.position.x,
      r1.chassis.position.z
    );

    // Closing speed: positive = approaching
    const relVelX = r1.chassis.linvel.x - r0.chassis.linvel.x;
    const relVelZ = r1.chassis.linvel.z - r0.chassis.linvel.z;
    const dirX = distToOpponent > 0.01 ? dx / distToOpponent : 0;
    const dirZ = distToOpponent > 0.01 ? dz / distToOpponent : 0;
    const closingSpeed = -(relVelX * dirX + relVelZ * dirZ);

    const mySpeed = Math.hypot(r0.chassis.linvel.x, r0.chassis.linvel.z);
    const opponentSpeed = Math.hypot(
      r1.chassis.linvel.x,
      r1.chassis.linvel.z
    );

    // Facing angles
    const myFacingAngle = this.getFacingAngle(r0.chassis.rotation);
    const opponentFacingAngle = this.getFacingAngle(r1.chassis.rotation);

    // Angle from my facing to opponent position (+ = right, - = left)
    const dirToOpponent = Math.atan2(dx, dz);
    const angleToOpponent = this.normalizeAngle(dirToOpponent - myFacingAngle);

    // Cooldowns (in seconds)
    const cooldowns = this.sim?.agentCooldowns ?? [0, 0];
    const myCooldownS = Math.round(cooldowns[0] * TICK_DURATION_S * 100) / 100;
    const opponentCooldownS = Math.round(cooldowns[1] * TICK_DURATION_S * 100) / 100;

    // Count incoming projectiles heading toward robot 0
    const incomingProjectiles = (state.projectiles ?? []).filter(
      (p) => p.ownerId === 1 // fired by opponent (agent 1)
    ).length;

    return {
      distanceToOpponent: Math.round(distToOpponent * 100) / 100,
      myDistFromCenter: Math.round(myDistFromCenter * 100) / 100,
      opponentDistFromCenter:
        Math.round(opponentDistFromCenter * 100) / 100,
      closingSpeed: Math.round(closingSpeed * 100) / 100,
      mySpeed: Math.round(mySpeed * 100) / 100,
      opponentSpeed: Math.round(opponentSpeed * 100) / 100,
      timeRemainingS:
        Math.round((MATCH_DURATION_S - state.elapsed) * 10) / 10,
      round: 0,
      myFacingAngle: Math.round(myFacingAngle * 100) / 100,
      opponentFacingAngle: Math.round(opponentFacingAngle * 100) / 100,
      angleToOpponent: Math.round(angleToOpponent * 100) / 100,
      myCooldownS,
      opponentCooldownS,
      incomingProjectiles,
    };
  }

  /** Flip tactical context for agent 1 (swap my/opponent) */
  private flipTactical(t: TacticalContext): TacticalContext {
    // For agent 1, recalculate angleToOpponent from their perspective
    // The flipped angle is approximately -angleToOpponent + PI (facing opposite)
    // But it's simpler to note that agent 1's incoming projectiles are those owned by agent 0
    const state = this._currentState;
    const incomingForAgent1 = (state?.projectiles ?? []).filter(
      (p) => p.ownerId === 0 // fired by agent 0
    ).length;

    // Recompute angle to opponent from agent 1's perspective
    const r0 = state?.robots[0];
    const r1 = state?.robots[1];
    let angleToOpponent1 = 0;
    if (r0 && r1) {
      const dx = r0.chassis.position.x - r1.chassis.position.x;
      const dz = r0.chassis.position.z - r1.chassis.position.z;
      const dirToOpponent = Math.atan2(dx, dz);
      angleToOpponent1 = this.normalizeAngle(dirToOpponent - t.opponentFacingAngle);
    }

    return {
      ...t,
      myDistFromCenter: t.opponentDistFromCenter,
      opponentDistFromCenter: t.myDistFromCenter,
      mySpeed: t.opponentSpeed,
      opponentSpeed: t.mySpeed,
      myFacingAngle: t.opponentFacingAngle,
      opponentFacingAngle: t.myFacingAngle,
      angleToOpponent: Math.round(angleToOpponent1 * 100) / 100,
      myCooldownS: t.opponentCooldownS,
      opponentCooldownS: t.myCooldownS,
      incomingProjectiles: incomingForAgent1,
    };
  }

  // ══════════════════════════════════════════
  // Internal Helpers
  // ══════════════════════════════════════════

  private buildViewerRobot(
    label: string,
    r: WorldState["robots"][0]
  ): object {
    return {
      id: label,
      position: [
        r.chassis.position.x,
        r.chassis.position.y,
        r.chassis.position.z,
      ],
      rotation: [
        r.chassis.rotation.x,
        r.chassis.rotation.y,
        r.chassis.rotation.z,
        r.chassis.rotation.w,
      ],
      armAngles: [r.leftArm.currentAngle, r.rightArm.currentAngle],
    };
  }

  private buildViewerProjectiles(state: WorldState): ViewerProjectileState[] {
    return (state.projectiles ?? []).map((p) => ({
      position: [p.position.x, p.position.y, p.position.z] as [number, number, number],
      ownerId: p.ownerId,
    }));
  }

  private buildThoughtsPayload(): object {
    const a0 = this.agents.get(0);
    const a1 = this.agents.get(1);
    return {
      thoughts: {
        A: {
          thought: a0?.lastThought ?? null,
          privateThought: a0?.lastPrivateThought ?? null,
        },
        B: {
          thought: a1?.lastThought ?? null,
          privateThought: a1?.lastPrivateThought ?? null,
        },
      },
      round: 0,
      agentNames: {
        A: a0?.name ?? "Robot A",
        B: a1?.name ?? "Robot B",
      },
    };
  }

  /** Capture a viewer frame for replay storage */
  private captureViewerFrame(state: WorldState): void {
    const r0 = state.robots[0];
    const r1 = state.robots[1];
    const a0 = this.agents.get(0);
    const a1 = this.agents.get(1);

    this.viewerFrameHistory.push({
      tick: state.tick,
      time: state.elapsed,
      robots: [
        {
          position: [
            r0.chassis.position.x,
            r0.chassis.position.y,
            r0.chassis.position.z,
          ],
          rotation: [
            r0.chassis.rotation.x,
            r0.chassis.rotation.y,
            r0.chassis.rotation.z,
            r0.chassis.rotation.w,
          ],
          armAngles: [r0.leftArm.currentAngle, r0.rightArm.currentAngle],
        },
        {
          position: [
            r1.chassis.position.x,
            r1.chassis.position.y,
            r1.chassis.position.z,
          ],
          rotation: [
            r1.chassis.rotation.x,
            r1.chassis.rotation.y,
            r1.chassis.rotation.z,
            r1.chassis.rotation.w,
          ],
          armAngles: [r1.leftArm.currentAngle, r1.rightArm.currentAngle],
        },
      ],
      projectiles: this.buildViewerProjectiles(state),
      thoughts: {
        A: {
          thought: a0?.lastThought ?? null,
          privateThought: a0?.lastPrivateThought ?? null,
        },
        B: {
          thought: a1?.lastThought ?? null,
          privateThought: a1?.lastPrivateThought ?? null,
        },
      },
      round: 0,
    });
  }

  private broadcastToSpectators(state: WorldState): void {
    const r0 = state.robots[0];
    const r1 = state.robots[1];
    const msg = JSON.stringify({
      type: "state",
      tick: state.tick,
      time: state.elapsed,
      robots: [
        this.buildViewerRobot("A", r0),
        this.buildViewerRobot("B", r1),
      ],
      matchPhase: state.matchPhase,
      projectiles: this.buildViewerProjectiles(state),
      ...this.buildThoughtsPayload(),
    });

    for (const ws of this.spectators) {
      try {
        ws.send(msg);
      } catch {
        this.spectators.delete(ws);
      }
    }
  }

  private handleMatchEnd(result: MatchResult): void {
    this.loop?.stop();
    this.stopInactivityChecker();

    // Store result for polling
    this.lastResult = result;

    console.log(
      `[Match] Ended: winner=${result.winner ?? "DRAW"} reason=${result.reason} tick=${result.finalTick}`
    );

    const endMsg = JSON.stringify({
      type: "match_end",
      winner: result.winner,
      reason: result.reason,
    });

    // Notify spectators (agents will see result via polling)
    for (const ws of this.spectators) {
      try {
        ws.send(endMsg);
      } catch {
        // ignore
      }
    }

    // Save replay with viewer frames (includes thoughts)
    if (this.sim) {
      const matchId = generateMatchId();
      const agentNames = {
        A: this.agents.get(0)?.name ?? "Robot A",
        B: this.agents.get(1)?.name ?? "Robot B",
      };
      saveReplay(
        matchId,
        result,
        this.sim.history,
        this.viewerFrameHistory,
        agentNames
      ).catch((err) => console.error("[Replay] Failed to save:", err));
    }

    // Cleanup sim but keep agents + tokens so they can poll for result
    this.sim?.destroy();
    this.sim = null;
    this.loop = null;
    this._currentState = null;
    this.ticksSinceLastBroadcast = 0;
    this.viewerFrameHistory = [];

    // Schedule full cleanup after agents have had time to poll for result
    setTimeout(() => {
      console.log("[Match] Full cleanup. Clearing agents and tokens.");
      for (const [, agent] of this.agents) {
        this.tokenToAgent.delete(agent.token);
      }
      this.agents.clear();
      this.lastResult = null;
      console.log("[Match] Reset. Waiting for new agents...");
    }, 15_000); // 15 seconds for agents to see the result
  }
}
