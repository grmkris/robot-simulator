/**
 * Match lifecycle orchestrator.
 * Bridges WebSocket agents to the simulation tick loop.
 * Handles: agent assignment, action collection, state broadcasting,
 * disconnect handling, and match reset.
 */
import { Simulation, GameLoop, initPhysics } from "@ai-arena/sim";
import type { ActionProvider } from "@ai-arena/sim";
import type {
  AgentAction,
  AgentId,
  MatchResult,
  WorldState,
} from "@ai-arena/protocol";
import {
  PROTOCOL_VERSION,
  ARENA_RADIUS,
  TICK_RATE,
  VIEWER_BROADCAST_INTERVAL,
} from "@ai-arena/protocol";
import type { WSContext } from "hono/ws";
import { saveReplay, generateMatchId } from "./replay-store.js";

const NO_OP: AgentAction = { leftArmTarget: 0, rightArmTarget: 0 };

interface ConnectedAgent {
  ws: WSContext;
  name: string;
  pendingAction: AgentAction | null;
  lastActionTick: number;
}

export class MatchManager {
  private agents = new Map<AgentId, ConnectedAgent>();
  private sim: Simulation | null = null;
  private loop: GameLoop | null = null;
  private _currentState: WorldState | null = null;
  private spectators = new Set<WSContext>();
  private ticksSinceLastBroadcast = 0;

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
      lastActionTick: -1,
    });

    console.log(`[Match] Agent "${name}" assigned as Robot ${id}`);

    // Send welcome message
    this.sendToAgent(id, {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      agentId: id,
      arenaRadius: ARENA_RADIUS,
      tickRate: TICK_RATE,
    });

    return id;
  }

  /** Start a match if both agents are connected */
  async tryStartMatch(): Promise<void> {
    if (this.agents.size < 2 || this.sim) return;

    console.log("[Match] Both agents connected. Starting match...");

    await initPhysics();
    this.sim = new Simulation();
    await this.sim.init();

    const actionProvider: ActionProvider = (
      agentId: AgentId,
      _state: WorldState
    ): AgentAction => {
      const agent = this.agents.get(agentId);
      if (!agent?.pendingAction) return { ...NO_OP };
      const action = agent.pendingAction;
      agent.pendingAction = null; // consume
      return action;
    };

    this.loop = new GameLoop(this.sim, actionProvider, {
      onTick: (state) => {
        this._currentState = state;
        this.broadcastToAgents(state);

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
  }

  /** Receive an action from an agent */
  receiveAction(
    agentId: AgentId,
    tick: number,
    action: AgentAction
  ): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.pendingAction = action;
    agent.lastActionTick = tick;
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
        ws.send(JSON.stringify({ type: "tick", ...this._currentState }));
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

  // ── Internal ──

  private broadcastToAgents(state: WorldState): void {
    for (const [id, agent] of this.agents) {
      this.sendToAgent(id, {
        type: "tick",
        tick: state.tick,
        you: id,
        robots: state.robots,
        matchPhase: state.matchPhase,
      });
    }
  }

  private broadcastToSpectators(state: WorldState): void {
    // Build compact viewer state
    const r0 = state.robots[0];
    const r1 = state.robots[1];
    const msg = JSON.stringify({
      type: "state",
      tick: state.tick,
      time: state.elapsed,
      robots: [
        {
          id: "A",
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
          id: "B",
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
      matchPhase: state.matchPhase,
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

    // Save replay
    if (this.sim) {
      const matchId = generateMatchId();
      saveReplay(matchId, result, this.sim.history).catch((err) =>
        console.error("[Replay] Failed to save:", err)
      );
    }

    // Cleanup
    this.sim?.destroy();
    this.sim = null;
    this.loop = null;
    this.agents.clear();
    this._currentState = null;
    this.ticksSinceLastBroadcast = 0;

    console.log("[Match] Reset. Waiting for new agents...");
  }
}
