/**
 * Match lifecycle orchestrator — Queue + Lobby Edition (v5).
 *
 * v5 changes: Agent queue, countdown phase, DB persistence, lobby broadcasts.
 * - Agents join a queue instead of directly getting a slot
 * - Server auto-pairs agents and starts matches with countdown
 * - Match results recorded to SQLite for leaderboard
 * - Lobby state broadcast to spectators via WebSocket
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
  QueueEntry,
  LobbyState,
  RobotBuild,
  RobotConfig,
} from "@ai-arena/protocol";
import {
  ARENA_RADIUS,
  TICK_RATE,
  TICK_DURATION_S,
  MATCH_DURATION_S,
  VIEWER_BROADCAST_INTERVAL,
  AGENT_INACTIVITY_TIMEOUT_MS,
  MAX_QUEUE_SIZE,
  QUEUE_INACTIVITY_TIMEOUT_MS,
  buildRobotConfig,
  DEFAULT_BUILD,
} from "@ai-arena/protocol";
import type { WSContext } from "hono/ws";
import {
  saveReplay,
  generateMatchId,
  type ViewerFrame,
} from "./replay-store.js";
import { recordMatch } from "./db.js";

const NO_OP: AgentAction = { leftArmTarget: 0, rightArmTarget: 0, driveForce: 0, turnRate: 0, shoot: false };

// ── Queue types ──

interface QueuedAgent {
  name: string;
  build: RobotBuild;
  token: string;
  joinedAt: number;
  lastPollTime: number;
}

// ── Active match agent ──

interface ConnectedAgent {
  token: string;
  name: string;
  build: RobotBuild;
  confirmedAction: AgentAction;
  lastPollTime: number;
  lastActionTick: number;
  lastThought: string | null;
  lastPrivateThought: string | null;
}

export class MatchManager {
  // ── Queue ──
  private queue: QueuedAgent[] = [];
  private tokenToQueue = new Map<string, QueuedAgent>();

  // ── Rooms (private matchmaking) ──
  private rooms = new Map<string, QueuedAgent[]>();
  private tokenToRoom = new Map<string, string>();
  private pendingPairs: Array<[QueuedAgent, QueuedAgent]> = [];

  // ── Active match ──
  private agents = new Map<AgentId, ConnectedAgent>();
  private tokenToAgent = new Map<string, AgentId>();
  private sim: Simulation | null = null;
  private loop: GameLoop | null = null;
  private _currentState: WorldState | null = null;
  private ticksSinceLastBroadcast = 0;
  private viewerFrameHistory: ViewerFrame[] = [];
  private inactivityTimer: ReturnType<typeof setInterval> | null = null;
  private lastResult: MatchResult | null = null;
  private currentMatchId: string | null = null;

  // ── Spectators ──
  private spectators = new Set<WSContext>();

  // ── Queue cleanup timer ──
  private queueCleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Clean inactive queue entries every 5 seconds
    this.queueCleanupTimer = setInterval(() => this.cleanQueue(), 5000);
  }

  // ══════════════════════════════════════════
  // Queue Management
  // ══════════════════════════════════════════

  get queueSize(): number {
    return this.queue.length;
  }

  get agentCount(): number {
    return this.agents.size;
  }

  get isMatchActive(): boolean {
    return this.sim !== null;
  }

  /** Add an agent to the queue (or a private room). Returns { token, position, build, room? } or null if full/duplicate. */
  enqueueAgent(name: string, build?: Partial<RobotBuild>, room?: string): { token: string; position: number; build: RobotBuild; room?: string } | null {
    // Check if name is already in queue, rooms, pending pairs, or active match
    const nameLower = name.toLowerCase();
    if (this.queue.some((q) => q.name.toLowerCase() === nameLower)) return null;
    for (const [, roomAgents] of this.rooms) {
      if (roomAgents.some((q) => q.name.toLowerCase() === nameLower)) return null;
    }
    for (const pair of this.pendingPairs) {
      if (pair.some((q) => q.name.toLowerCase() === nameLower)) return null;
    }
    for (const [, agent] of this.agents) {
      if (agent.name.toLowerCase() === nameLower) return null;
    }

    const token = crypto.randomUUID();
    const now = Date.now();
    const resolvedBuild: RobotBuild = {
      chassis: build?.chassis ?? DEFAULT_BUILD.chassis,
      arms: build?.arms ?? DEFAULT_BUILD.arms,
      weapon: build?.weapon ?? DEFAULT_BUILD.weapon,
    };
    const entry: QueuedAgent = { name, build: resolvedBuild, token, joinedAt: now, lastPollTime: now };

    if (room) {
      // ── Room-based matchmaking ──
      const roomAgents = this.rooms.get(room) ?? [];
      if (roomAgents.length >= 2) return null; // room full

      roomAgents.push(entry);
      this.rooms.set(room, roomAgents);
      this.tokenToRoom.set(token, room);
      this.tokenToQueue.set(token, entry);

      console.log(`[Room:${room}] "${name}" joined (${roomAgents.length}/2, token=${token.slice(0, 8)}...)`);

      if (roomAgents.length === 2) {
        const a = roomAgents[0]!;
        const b = roomAgents[1]!;
        this.rooms.delete(room);
        this.tokenToRoom.delete(a.token);
        this.tokenToRoom.delete(b.token);
        this.pendingPairs.push([a, b]);
        console.log(`[Room:${room}] Pair ready: "${a.name}" vs "${b.name}"`);
        this.tryMatchFromQueue();
      }

      this.broadcastLobbyState();
      return { token, position: roomAgents.length, build: resolvedBuild, room };
    }

    // ── Public queue ──
    if (this.queue.length >= MAX_QUEUE_SIZE) return null;

    this.queue.push(entry);
    this.tokenToQueue.set(token, entry);

    console.log(`[Queue] "${name}" joined queue (position ${this.queue.length}, token=${token.slice(0, 8)}...)`);
    this.broadcastLobbyState();
    this.tryMatchFromQueue();

    return { token, position: this.queue.length, build: resolvedBuild };
  }

  /** Remove an agent from queue, room, or pending pair by token. */
  dequeueByToken(token: string): boolean {
    // Check room first
    const room = this.tokenToRoom.get(token);
    if (room) {
      const roomAgents = this.rooms.get(room);
      if (roomAgents) {
        const idx = roomAgents.findIndex((q) => q.token === token);
        if (idx !== -1) {
          const removed = roomAgents.splice(idx, 1)[0]!;
          console.log(`[Room:${room}] "${removed.name}" left`);
          if (roomAgents.length === 0) this.rooms.delete(room);
        }
      }
      this.tokenToRoom.delete(token);
      this.tokenToQueue.delete(token);
      this.broadcastLobbyState();
      return true;
    }

    // Check pending pairs
    for (let i = 0; i < this.pendingPairs.length; i++) {
      const pair = this.pendingPairs[i]!;
      const matchIdx = pair.findIndex((a) => a.token === token);
      if (matchIdx !== -1) {
        const other = pair[1 - matchIdx]!;
        this.pendingPairs.splice(i, 1);
        this.tokenToQueue.delete(token);
        // Put the remaining agent back in the public queue
        this.queue.push(other);
        console.log(`[Queue] "${other.name}" moved to public queue (room partner left)`);
        this.broadcastLobbyState();
        return true;
      }
    }

    // Public queue
    const entry = this.tokenToQueue.get(token);
    if (!entry) return false;

    this.queue = this.queue.filter((q) => q.token !== token);
    this.tokenToQueue.delete(token);
    console.log(`[Queue] "${entry.name}" left queue`);
    this.broadcastLobbyState();
    return true;
  }

  /** Get queue state for a token (returns position or null if not in queue/room). */
  getQueuePosition(token: string): { position: number; queueSize: number; room?: string } | null {
    const entry = this.tokenToQueue.get(token);
    if (!entry) return null;
    entry.lastPollTime = Date.now();

    // Check if in a room
    const room = this.tokenToRoom.get(token);
    if (room) {
      const roomAgents = this.rooms.get(room);
      return { position: 1, queueSize: roomAgents?.length ?? 1, room };
    }

    // Check if in a pending pair (matched, waiting for arena)
    for (const pair of this.pendingPairs) {
      if (pair.some((a) => a.token === token)) {
        return { position: 1, queueSize: 2, room: "(matched)" };
      }
    }

    // Public queue
    const idx = this.queue.indexOf(entry);
    if (idx === -1) return null;
    return { position: idx + 1, queueSize: this.queue.length };
  }

  /** Clean out agents that haven't polled in QUEUE_INACTIVITY_TIMEOUT_MS */
  private cleanQueue(): void {
    const now = Date.now();
    let changed = false;

    // Clean public queue
    const before = this.queue.length;
    this.queue = this.queue.filter((q) => {
      if (now - q.lastPollTime > QUEUE_INACTIVITY_TIMEOUT_MS) {
        console.log(`[Queue] "${q.name}" timed out (inactive ${((now - q.lastPollTime) / 1000).toFixed(0)}s)`);
        this.tokenToQueue.delete(q.token);
        return false;
      }
      return true;
    });
    if (this.queue.length !== before) changed = true;

    // Clean rooms
    for (const [roomCode, agents] of this.rooms) {
      const remaining = agents.filter((q) => {
        if (now - q.lastPollTime > QUEUE_INACTIVITY_TIMEOUT_MS) {
          console.log(`[Room:${roomCode}] "${q.name}" timed out`);
          this.tokenToQueue.delete(q.token);
          this.tokenToRoom.delete(q.token);
          changed = true;
          return false;
        }
        return true;
      });
      if (remaining.length === 0) {
        this.rooms.delete(roomCode);
      } else {
        this.rooms.set(roomCode, remaining);
      }
    }

    // Clean pending pairs — drop pairs where either agent timed out
    this.pendingPairs = this.pendingPairs.filter(([a, b]) => {
      const aAlive = now - a.lastPollTime <= QUEUE_INACTIVITY_TIMEOUT_MS;
      const bAlive = now - b.lastPollTime <= QUEUE_INACTIVITY_TIMEOUT_MS;
      if (!aAlive || !bAlive) {
        if (!aAlive) this.tokenToQueue.delete(a.token);
        if (!bAlive) this.tokenToQueue.delete(b.token);
        // Put surviving agent back in public queue
        const survivor = aAlive ? a : bAlive ? b : null;
        if (survivor) {
          this.queue.push(survivor);
          console.log(`[Queue] "${survivor.name}" moved to public queue (partner timed out)`);
        }
        changed = true;
        return false;
      }
      return true;
    });

    if (changed) {
      this.broadcastLobbyState();
    }
  }

  /** Try to pop 2 agents from queue (or pending room pair) and start a match. */
  private tryMatchFromQueue(): void {
    if (this.sim || this.agents.size > 0) return; // match already in progress
    if (this.lastResult) return; // still in post-match window

    let agentA: QueuedAgent;
    let agentB: QueuedAgent;

    // Priority: pending room pairs first, then public queue
    if (this.pendingPairs.length > 0) {
      [agentA, agentB] = this.pendingPairs.shift()!;
    } else if (this.queue.length >= 2) {
      agentA = this.queue.shift()!;
      agentB = this.queue.shift()!;
    } else {
      return;
    }

    this.tokenToQueue.delete(agentA.token);
    this.tokenToQueue.delete(agentB.token);

    // Assign to match slots
    this.agents.set(0, {
      token: agentA.token,
      name: agentA.name,
      build: agentA.build,
      confirmedAction: { ...NO_OP },
      lastPollTime: Date.now(),
      lastActionTick: 0,
      lastThought: null,
      lastPrivateThought: null,
    });
    this.agents.set(1, {
      token: agentB.token,
      name: agentB.name,
      build: agentB.build,
      confirmedAction: { ...NO_OP },
      lastPollTime: Date.now(),
      lastActionTick: 0,
      lastThought: null,
      lastPrivateThought: null,
    });
    this.tokenToAgent.set(agentA.token, 0);
    this.tokenToAgent.set(agentB.token, 1);

    console.log(`[Match] Matched "${agentA.name}" vs "${agentB.name}" from queue`);
    this.broadcastLobbyState();
    this.startMatch();
  }

  // ══════════════════════════════════════════
  // Token Resolution (queue OR active match)
  // ══════════════════════════════════════════

  /** Check if a token belongs to a queued agent */
  isQueued(token: string): boolean {
    return this.tokenToQueue.has(token);
  }

  /** Resolve a Bearer token to an AgentId (active match only, not queue) */
  resolveToken(token: string): AgentId | null {
    return this.tokenToAgent.get(token) ?? null;
  }

  // ══════════════════════════════════════════
  // Game State for Agents
  // ══════════════════════════════════════════

  /** Build game state response for a specific agent */
  getGameStateForAgent(agentId: AgentId): GameStateResponse {
    const agent = this.agents.get(agentId);
    if (!agent) return { status: "waiting" };

    // Update heartbeat
    agent.lastPollTime = Date.now();

    // No sim yet → waiting
    if (!this.sim || !this._currentState) {
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

    const opponentAgent = this.agents.get(opponentId);
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
      myBuild: agent.build,
      opponentBuild: opponentAgent?.build ?? DEFAULT_BUILD,
    };
  }

  /** Receive an action from an agent via HTTP */
  receiveAction(agentId: AgentId, action: AgentAction): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    agent.confirmedAction = {
      leftArmTarget: action.leftArmTarget,
      rightArmTarget: action.rightArmTarget,
      driveForce: action.driveForce ?? 0,
      turnRate: action.turnRate ?? 0,
      shoot: action.shoot ?? false,
    };

    agent.lastThought = action.thought ?? null;
    agent.lastPrivateThought = action.privateThought ?? null;
    agent.lastActionTick = this._currentState?.tick ?? 0;
    agent.lastPollTime = Date.now();

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

    if (agent) {
      this.tokenToAgent.delete(agent.token);
    }
    this.agents.delete(agentId);

    if (this.sim && (this.sim.phase === "active" || this.sim.phase === "countdown")) {
      const winner: AgentId = agentId === 0 ? 1 : 0;
      this.handleMatchEnd({
        winner,
        reason: "disconnect",
        finalTick: this.sim.currentTick,
      });
    }
  }

  /** Handle leave by token — works for both queue and active match */
  handleLeaveByToken(token: string): boolean {
    // Check queue first
    if (this.dequeueByToken(token)) return true;

    // Check active match
    const agentId = this.resolveToken(token);
    if (agentId !== null) {
      this.handleAgentLeave(agentId);
      return true;
    }

    return false;
  }

  // ══════════════════════════════════════════
  // Match Lifecycle
  // ══════════════════════════════════════════

  /** Start a match (called after 2 agents are paired from queue) */
  private async startMatch(): Promise<void> {
    if (this.agents.size < 2 || this.sim) return;

    const agent0 = this.agents.get(0);
    const agent1 = this.agents.get(1);
    console.log(
      `[Match] "${agent0?.name}" vs "${agent1?.name}" — Starting match with countdown...`
    );

    await initPhysics();
    this.sim = new Simulation();
    const configs: [RobotConfig, RobotConfig] = [
      buildRobotConfig(agent0!.build),
      buildRobotConfig(agent1!.build),
    ];
    await this.sim.init(configs);
    this.viewerFrameHistory = [];
    this.lastResult = null;
    this.currentMatchId = generateMatchId();

    const actionProvider: ActionProvider = (
      agentId: AgentId,
      _state: WorldState
    ): AgentAction => {
      const agent = this.agents.get(agentId);
      if (!agent) return { ...NO_OP };
      const action = { ...agent.confirmedAction };
      if (action.shoot) {
        agent.confirmedAction.shoot = false;
      }
      return action;
    };

    this.loop = new GameLoop(this.sim, actionProvider, {
      onTick: (state) => {
        this._currentState = state;
        this.captureViewerFrame(state);

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
    this.startInactivityChecker();
  }

  // ══════════════════════════════════════════
  // Spectator WebSocket
  // ══════════════════════════════════════════

  addSpectator(ws: WSContext): void {
    this.spectators.add(ws);
    console.log(
      `[Match] Spectator connected (total: ${this.spectators.size})`
    );

    // Send current match state if available
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

    // Always send lobby state on connect
    this.sendLobbyStateTo(ws);
  }

  removeSpectator(ws: WSContext): void {
    this.spectators.delete(ws);
    console.log(
      `[Match] Spectator disconnected (total: ${this.spectators.size})`
    );
  }

  // ══════════════════════════════════════════
  // Lobby State Broadcasting
  // ══════════════════════════════════════════

  /** Build lobby state object */
  buildLobbyState(): LobbyState {
    const queue: QueueEntry[] = this.queue.map((q, i) => ({
      name: q.name,
      position: i + 1,
      build: q.build,
    }));

    const agent0 = this.agents.get(0);
    const agent1 = this.agents.get(1);
    const currentMatch =
      agent0 && agent1
        ? {
            agentA: agent0.name,
            agentB: agent1.name,
            phase: this._currentState?.matchPhase ?? ("waiting" as const),
            tick: this._currentState?.tick ?? 0,
            time: this._currentState?.elapsed ?? 0,
          }
        : null;

    return { type: "lobby", queue, currentMatch, roomsWaiting: this.rooms.size };
  }

  /** Send lobby state to a single spectator */
  private sendLobbyStateTo(ws: WSContext): void {
    try {
      ws.send(JSON.stringify(this.buildLobbyState()));
    } catch {
      // ignore
    }
  }

  /** Broadcast lobby state to all spectators */
  broadcastLobbyState(): void {
    const msg = JSON.stringify(this.buildLobbyState());
    for (const ws of this.spectators) {
      try {
        ws.send(msg);
      } catch {
        this.spectators.delete(ws);
      }
    }
  }

  // ══════════════════════════════════════════
  // Inactivity Detection
  // ══════════════════════════════════════════

  private startInactivityChecker(): void {
    this.inactivityTimer = setInterval(() => {
      if (!this.sim || this.sim.phase === "finished") return;
      // Don't kick agents during countdown
      if (this.sim.phase !== "active") return;

      const now = Date.now();
      for (const [id, agent] of this.agents) {
        const inactiveMs = now - agent.lastPollTime;
        if (inactiveMs > AGENT_INACTIVITY_TIMEOUT_MS) {
          console.log(
            `[Match] Agent ${id} ("${agent.name}") forfeited: inactive for ${(inactiveMs / 1000).toFixed(1)}s`
          );
          this.handleAgentLeave(id);
          return;
        }
      }
    }, 1000);
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

  private getFacingAngle(rot: { x: number; y: number; z: number; w: number }): number {
    const fw_x = 2 * (rot.x * rot.z + rot.w * rot.y);
    const fw_z = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
    return Math.atan2(fw_x, fw_z);
  }

  private normalizeAngle(angle: number): number {
    while (angle > Math.PI) angle -= 2 * Math.PI;
    while (angle < -Math.PI) angle += 2 * Math.PI;
    return angle;
  }

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

    const myFacingAngle = this.getFacingAngle(r0.chassis.rotation);
    const opponentFacingAngle = this.getFacingAngle(r1.chassis.rotation);

    const dirToOpponent = Math.atan2(dx, dz);
    const angleToOpponent = this.normalizeAngle(dirToOpponent - myFacingAngle);

    const cooldowns = this.sim?.agentCooldowns ?? [0, 0];
    const myCooldownS = Math.round(cooldowns[0] * TICK_DURATION_S * 100) / 100;
    const opponentCooldownS = Math.round(cooldowns[1] * TICK_DURATION_S * 100) / 100;

    const incomingProjectiles = (state.projectiles ?? []).filter(
      (p) => p.ownerId === 1
    ).length;

    const agent0 = this.agents.get(0);
    const agent1 = this.agents.get(1);

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
      myBuild: agent0?.build ?? DEFAULT_BUILD,
      opponentBuild: agent1?.build ?? DEFAULT_BUILD,
    };
  }

  private flipTactical(t: TacticalContext): TacticalContext {
    const state = this._currentState;
    const incomingForAgent1 = (state?.projectiles ?? []).filter(
      (p) => p.ownerId === 0
    ).length;

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
      myBuild: t.opponentBuild,
      opponentBuild: t.myBuild,
    };
  }

  // ══════════════════════════════════════════
  // Internal Helpers
  // ══════════════════════════════════════════

  get currentState(): WorldState | null {
    return this._currentState;
  }

  private buildViewerRobot(
    label: string,
    r: WorldState["robots"][0]
  ): object {
    return {
      id: label,
      build: r.build,
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
      builds: {
        A: a0?.build ?? DEFAULT_BUILD,
        B: a1?.build ?? DEFAULT_BUILD,
      },
    };
  }

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
          position: [r0.chassis.position.x, r0.chassis.position.y, r0.chassis.position.z],
          rotation: [r0.chassis.rotation.x, r0.chassis.rotation.y, r0.chassis.rotation.z, r0.chassis.rotation.w],
          armAngles: [r0.leftArm.currentAngle, r0.rightArm.currentAngle],
          build: a0?.build,
        },
        {
          position: [r1.chassis.position.x, r1.chassis.position.y, r1.chassis.position.z],
          rotation: [r1.chassis.rotation.x, r1.chassis.rotation.y, r1.chassis.rotation.z, r1.chassis.rotation.w],
          armAngles: [r1.leftArm.currentAngle, r1.rightArm.currentAngle],
          build: a1?.build,
        },
      ],
      projectiles: this.buildViewerProjectiles(state),
      thoughts: {
        A: { thought: a0?.lastThought ?? null, privateThought: a0?.lastPrivateThought ?? null },
        B: { thought: a1?.lastThought ?? null, privateThought: a1?.lastPrivateThought ?? null },
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

    this.lastResult = result;

    const agent0 = this.agents.get(0);
    const agent1 = this.agents.get(1);
    const nameA = agent0?.name ?? "Robot A";
    const nameB = agent1?.name ?? "Robot B";

    console.log(
      `[Match] Ended: winner=${result.winner ?? "DRAW"} reason=${result.reason} tick=${result.finalTick}`
    );

    // Record to database
    const durationS = result.finalTick / TICK_RATE;
    try {
      recordMatch(
        this.currentMatchId ?? generateMatchId(),
        nameA,
        nameB,
        result.winner,
        result.reason,
        result.finalTick,
        durationS
      );
    } catch (err) {
      console.error("[DB] Failed to record match:", err);
    }

    // Notify spectators
    const endMsg = JSON.stringify({
      type: "match_end",
      winner: result.winner,
      reason: result.reason,
    });
    for (const ws of this.spectators) {
      try {
        ws.send(endMsg);
      } catch {
        // ignore
      }
    }

    // Save replay
    if (this.sim) {
      const matchId = this.currentMatchId ?? generateMatchId();
      const agentNames = { A: nameA, B: nameB };
      const agentBuilds = {
        A: agent0?.build ?? DEFAULT_BUILD,
        B: agent1?.build ?? DEFAULT_BUILD,
      };
      saveReplay(
        matchId,
        result,
        this.sim.history,
        this.viewerFrameHistory,
        agentNames,
        agentBuilds
      ).catch((err) => console.error("[Replay] Failed to save:", err));
    }

    // Cleanup sim but keep agents + tokens so they can poll for result
    this.sim?.destroy();
    this.sim = null;
    this.loop = null;
    this._currentState = null;
    this.ticksSinceLastBroadcast = 0;
    this.viewerFrameHistory = [];
    this.currentMatchId = null;

    // Schedule full cleanup and next match
    setTimeout(() => {
      console.log("[Match] Full cleanup. Clearing agents and tokens.");
      for (const [, agent] of this.agents) {
        this.tokenToAgent.delete(agent.token);
      }
      this.agents.clear();
      this.lastResult = null;
      this.broadcastLobbyState();

      // Try to start the next match from queue
      console.log(`[Match] Reset. Queue has ${this.queue.length} agents waiting.`);
      this.tryMatchFromQueue();
    }, 10_000);
  }
}
