/**
 * ArenaClient — TypeScript SDK for connecting AI agents to the arena.
 *
 * Supports both legacy tick-based agents and new Mind Games decision_window agents.
 *
 * Usage (simple):
 *   const client = new ArenaClient({
 *     serverUrl: "ws://localhost:3000/ws/agent",
 *     name: "MyBot",
 *     brain: (agentId, state) => ({ leftArmTarget: 0.5, rightArmTarget: -0.3 }),
 *   });
 *   client.connect();
 *
 * Usage (Mind Games — async + thoughts):
 *   const client = new ArenaClient({
 *     serverUrl: "ws://localhost:3000/ws/agent",
 *     name: "ClaudeBot",
 *     brain: async (agentId, state, context) => ({
 *       leftArmTarget: 0.5,
 *       rightArmTarget: -0.3,
 *       thought: "I see you...",
 *       privateThought: "Going for the left flank",
 *     }),
 *   });
 *   client.connect();
 */
import type {
  AgentAction,
  AgentId,
  WorldState,
  MatchPhase,
  TacticalContext,
  RobotBuild,
} from "@ai-arena/protocol";
import { TICK_RATE } from "@ai-arena/protocol";

/** Context provided to the brain in Mind Games mode (decision_window) */
export interface DecisionContext {
  /** Pre-computed tactical data (distances, speeds, closing rate) */
  tactical: TacticalContext;
  /** Your current action (persists until you send a new one) */
  currentAction: AgentAction;
  /** Opponent's last public thought (for mind games!) */
  opponentThought: string | null;
  /** Current decision round number */
  round: number;
}

/**
 * The brain function an agent author implements.
 *
 * Can be sync or async. When called from a decision_window, receives
 * extra context (tactical info, opponent thoughts, etc.).
 */
export type AgentBrain = (
  agentId: AgentId,
  state: WorldState,
  context?: DecisionContext
) => AgentAction | Promise<AgentAction>;

export interface ArenaClientOptions {
  /** WebSocket URL, e.g. "ws://localhost:3000/ws/agent" */
  serverUrl: string;
  /** Agent display name (max 32 chars) */
  name: string;
  /** The decision function — sync or async */
  brain: AgentBrain;
  /** Called when match ends */
  onMatchEnd?: (winner: AgentId | null, reason: string) => void;
  /** Called on protocol errors */
  onError?: (error: string) => void;
  /** Robot build configuration (optional, defaults to medium/standard/standard) */
  build?: Partial<RobotBuild>;
}

export class ArenaClient {
  private ws: WebSocket | null = null;
  private agentId: AgentId | null = null;
  private readonly options: ArenaClientOptions;

  constructor(options: ArenaClientOptions) {
    this.options = options;
  }

  /** Connect to the arena server */
  connect(): void {
    console.log(`[${this.options.name}] Connecting to ${this.options.serverUrl}...`);
    this.ws = new WebSocket(this.options.serverUrl);

    this.ws.onopen = () => {
      console.log(`[${this.options.name}] Connected. Sending join...`);
      this.ws!.send(
        JSON.stringify({
          type: "join",
          name: this.options.name,
          build: this.options.build,
        })
      );
    };

    this.ws.onmessage = (event) => {
      const raw =
        typeof event.data === "string"
          ? event.data
          : event.data.toString();

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error(`[${this.options.name}] Invalid JSON from server`);
        return;
      }

      this.handleMessage(parsed as Record<string, unknown>);
    };

    this.ws.onclose = () => {
      console.log(`[${this.options.name}] Disconnected from server`);
    };

    this.ws.onerror = (err) => {
      console.error(`[${this.options.name}] WebSocket error`);
    };
  }

  /** Disconnect from the server */
  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "welcome": {
        this.agentId = msg.agentId as AgentId;
        const decisionRate = msg.decisionRate as number | undefined;
        console.log(
          `[${this.options.name}] Assigned as Robot ${this.agentId}` +
          (decisionRate ? ` (${decisionRate}Hz decisions)` : "") +
          `. Waiting for match...`
        );
        break;
      }

      // ── Mind Games: 2Hz decision windows ──
      case "decision_window": {
        if (this.agentId === null) return;

        const round = msg.round as number;
        const tick = msg.tick as number;
        const robots = msg.robots as WorldState["robots"];
        const matchPhase = msg.matchPhase as MatchPhase;
        const tactical = msg.tactical as TacticalContext;
        const yourLastAction = msg.yourLastAction as AgentAction;
        const opponentLastThought = msg.opponentLastThought as string | null;

        const worldState: WorldState = {
          tick,
          elapsed: tick / TICK_RATE,
          robots,
          projectiles: [],
          matchPhase,
        };

        const context: DecisionContext = {
          tactical,
          currentAction: yourLastAction,
          opponentThought: opponentLastThought,
          round,
        };

        // Call brain — supports both sync and async
        const result = this.options.brain(this.agentId, worldState, context);
        Promise.resolve(result)
          .then((action) => {
            this.ws?.send(
              JSON.stringify({
                type: "action",
                round,
                action,
              })
            );
          })
          .catch((err) => {
            console.error(`[${this.options.name}] Brain error:`, err);
          });
        break;
      }

      // ── Legacy: per-tick state (backward compat) ──
      case "tick": {
        if (this.agentId === null) return;
        const matchPhase = msg.matchPhase as MatchPhase;
        if (matchPhase !== "active") return;

        const tick = msg.tick as number;
        const robots = msg.robots as WorldState["robots"];

        const worldState: WorldState = {
          tick,
          elapsed: tick / TICK_RATE,
          robots,
          projectiles: [],
          matchPhase,
        };

        // Call brain (no context for legacy mode)
        const action = this.options.brain(this.agentId, worldState);
        Promise.resolve(action)
          .then((a) => {
            this.ws?.send(
              JSON.stringify({
                type: "action",
                tick,
                action: a,
              })
            );
          })
          .catch((err) => {
            console.error(`[${this.options.name}] Brain error:`, err);
          });
        break;
      }

      case "match_end": {
        const winner = msg.winner as AgentId | null;
        const reason = msg.reason as string;
        console.log(
          `[${this.options.name}] Match ended: winner=${winner ?? "DRAW"} reason=${reason}`
        );
        this.options.onMatchEnd?.(winner, reason);
        break;
      }

      case "error": {
        const errMsg = msg.message as string;
        console.error(`[${this.options.name}] Server error: ${errMsg}`);
        this.options.onError?.(errMsg);
        break;
      }
    }
  }
}
