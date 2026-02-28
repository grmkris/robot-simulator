/**
 * Match lifecycle orchestrator — Mind Games Edition.
 *
 * Key changes from v1:
 * - 2Hz decision cadence (agents get decision_window every 500ms)
 * - Action persistence (last action holds between decisions)
 * - Thought tracking (public + private thoughts for mind games)
 * - Tactical context (pre-computed distances/speeds for LLM agents)
 */
import { Simulation, GameLoop, initPhysics } from "@ai-arena/sim";
import type { ActionProvider } from "@ai-arena/sim";
import type {
  AgentAction,
  AgentId,
  MatchResult,
  WorldState,
  TacticalContext,
} from "@ai-arena/protocol";
import {
  PROTOCOL_VERSION,
  ARENA_RADIUS,
  TICK_RATE,
  MATCH_DURATION_S,
  VIEWER_BROADCAST_INTERVAL,
  AGENT_DECISION_RATE,
  AGENT_DECISION_DEADLINE_MS,
  AGENT_MAX_CONSECUTIVE_TIMEOUTS,
} from "@ai-arena/protocol";
import type { WSContext } from "hono/ws";
import {
  saveReplay,
  generateMatchId,
  type ViewerFrame,
} from "./replay-store.js";

const NO_OP: AgentAction = { leftArmTarget: 0, rightArmTarget: 0 };

interface ConnectedAgent {
  ws: WSContext;
  name: string;
  /** Pending action from newest message (consumed into confirmedAction) */
  pendingAction: AgentAction | null;
  /** Persists between decisions — the robot keeps doing this */
  confirmedAction: AgentAction;
  /** Which decision round the agent last responded to */
  lastDecisionRound: number;
  /** Count of consecutive missed decision windows */
  consecutiveTimeouts: number;
  /** Public thought — visible to opponent + spectators */
  lastThought: string | null;
  /** Private thought — visible to spectators only */
  lastPrivateThought: string | null;
}

export class MatchManager {
  private agents = new Map<AgentId, ConnectedAgent>();
  private sim: Simulation | null = null;
  private loop: GameLoop | null = null;
  private _currentState: WorldState | null = null;
  private spectators = new Set<WSContext>();
  private ticksSinceLastBroadcast = 0;
  private viewerFrameHistory: ViewerFrame[] = [];
  private decisionRound = 0;
  private decisionInterval: ReturnType<typeof setInterval> | null = null;

  get currentState(): WorldState | null {
    return this._currentState;
  }

  get agentCount(): number {
    return this.agents.size;
  }

  /** Assign an agent ID to a new WebSocket connection */
  assignAgent(ws: WSContext, name: string): AgentId | null {
    if (this.agents.size >= 2) return null;

    const id: AgentId = this.agents.has(0) ? 1 : 0;
    this.agents.set(id, {
      ws,
      name,
      pendingAction: null,
      confirmedAction: { ...NO_OP },
      lastDecisionRound: -1,
      consecutiveTimeouts: 0,
      lastThought: null,
      lastPrivateThought: null,
    });

    console.log(`[Match] Agent "${name}" assigned as Robot ${id}`);

    // Send welcome message with decision rate
    this.sendToAgent(id, {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      agentId: id,
      arenaRadius: ARENA_RADIUS,
      tickRate: TICK_RATE,
      decisionRate: AGENT_DECISION_RATE,
    });

    return id;
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
    this.decisionRound = 0;

    // ACTION PERSISTENCE: return confirmedAction (never null)
    const actionProvider: ActionProvider = (
      agentId: AgentId,
      _state: WorldState
    ): AgentAction => {
      const agent = this.agents.get(agentId);
      if (!agent) return { ...NO_OP };
      return agent.confirmedAction;
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

    // Start 2Hz decision cadence
    this.startDecisionCadence();
  }

  /** Receive an action from an agent (round-based or tick-based) */
  receiveAction(
    agentId: AgentId,
    action: AgentAction,
    round?: number
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Reject actions for rounds that are too old
    if (round !== undefined && round < this.decisionRound - 1) return;

    // Update confirmed action (persists until next decision)
    agent.confirmedAction = {
      leftArmTarget: action.leftArmTarget,
      rightArmTarget: action.rightArmTarget,
    };

    // Track thoughts
    agent.lastThought = action.thought ?? null;
    agent.lastPrivateThought = action.privateThought ?? null;

    // Track decision round
    if (round !== undefined) {
      agent.lastDecisionRound = round;
    }
    agent.consecutiveTimeouts = 0;

    const thoughtPreview = agent.lastThought
      ? ` 💭 "${agent.lastThought.slice(0, 50)}"`
      : "";
    console.log(
      `[Match] Agent ${agentId} ("${agent.name}") action: L=${action.leftArmTarget.toFixed(2)} R=${action.rightArmTarget.toFixed(2)}${thoughtPreview}`
    );
  }

  /** Handle agent disconnection */
  handleDisconnect(agentId: AgentId): void {
    const agent = this.agents.get(agentId);
    console.log(
      `[Match] Agent "${agent?.name}" (Robot ${agentId}) disconnected`
    );
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

  // ── Decision Cadence ──

  private startDecisionCadence(): void {
    const intervalMs = 1000 / AGENT_DECISION_RATE; // 500ms

    this.decisionInterval = setInterval(() => {
      if (!this.sim || this.sim.phase !== "active" || !this._currentState)
        return;

      const state = this._currentState;
      const round = this.decisionRound;

      // Build tactical context
      const tactical = this.buildTacticalContext(state);

      // Send decision window to each agent
      for (const [id, agent] of this.agents) {
        const opponentId: AgentId = id === 0 ? 1 : 0;
        const opponent = this.agents.get(opponentId);

        this.sendToAgent(id, {
          type: "decision_window",
          round,
          tick: state.tick,
          you: id,
          robots: state.robots,
          matchPhase: state.matchPhase,
          tactical: id === 0 ? tactical : this.flipTactical(tactical),
          yourLastAction: agent.confirmedAction,
          opponentLastThought: opponent?.lastThought ?? null,
          deadline_ms: AGENT_DECISION_DEADLINE_MS,
        });
      }

      // Check timeouts for previous round
      if (round > 0) {
        for (const [id, agent] of this.agents) {
          if (agent.lastDecisionRound < round - 1) {
            agent.consecutiveTimeouts++;
            if (
              agent.consecutiveTimeouts >= AGENT_MAX_CONSECUTIVE_TIMEOUTS
            ) {
              console.log(
                `[Match] Agent ${id} ("${agent.name}") forfeited: ${AGENT_MAX_CONSECUTIVE_TIMEOUTS} consecutive timeouts`
              );
              this.handleDisconnect(id);
              return;
            }
          }
        }
      }

      this.decisionRound++;
    }, intervalMs);
  }

  private stopDecisionCadence(): void {
    if (this.decisionInterval) {
      clearInterval(this.decisionInterval);
      this.decisionInterval = null;
    }
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
      round: this.decisionRound,
    };
  }

  /** Flip tactical context for agent 1 (swap my/opponent) */
  private flipTactical(t: TacticalContext): TacticalContext {
    return {
      ...t,
      myDistFromCenter: t.opponentDistFromCenter,
      opponentDistFromCenter: t.myDistFromCenter,
      mySpeed: t.opponentSpeed,
      opponentSpeed: t.mySpeed,
    };
  }

  // ── Internal ──

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
      round: this.decisionRound,
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
      round: this.decisionRound,
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

  private sendToAgent(agentId: AgentId, msg: unknown): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    try {
      agent.ws.send(JSON.stringify(msg));
    } catch {
      // WS might be closed
    }
  }

  private handleMatchEnd(result: MatchResult): void {
    this.loop?.stop();
    this.stopDecisionCadence();

    console.log(
      `[Match] Ended: winner=${result.winner ?? "DRAW"} reason=${result.reason} tick=${result.finalTick}`
    );

    const endMsg = JSON.stringify({
      type: "match_end",
      winner: result.winner,
      reason: result.reason,
    });

    // Notify agents
    for (const [, agent] of this.agents) {
      try {
        agent.ws.send(endMsg);
      } catch {
        // ignore
      }
    }

    // Notify spectators
    for (const ws of this.spectators) {
      try {
        ws.send(endMsg);
      } catch {
        // ignore
      }
    }

    // Save replay with viewer frames (now includes thoughts)
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

    // Cleanup
    this.sim?.destroy();
    this.sim = null;
    this.loop = null;
    this.agents.clear();
    this._currentState = null;
    this.ticksSinceLastBroadcast = 0;
    this.viewerFrameHistory = [];
    this.decisionRound = 0;

    console.log("[Match] Reset. Waiting for new agents...");
  }
}
