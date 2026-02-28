/**
 * ArenaClient — TypeScript SDK for connecting AI agents to the arena.
 *
 * Usage:
 *   const client = new ArenaClient({
 *     serverUrl: "ws://localhost:3000/ws/agent",
 *     name: "MyBot",
 *     brain: (agentId, state) => ({ leftArmTarget: 0.5, rightArmTarget: -0.3 }),
 *   });
 *   client.connect();
 */
import type {
  AgentAction,
  AgentId,
  WorldState,
  MatchPhase,
} from "@ai-arena/protocol";
import { TICK_RATE } from "@ai-arena/protocol";

/**
 * The brain function an agent author implements.
 * Receives the current world state and assigned agent ID.
 * Returns the action to take this tick.
 */
export type AgentBrain = (
  agentId: AgentId,
  state: WorldState
) => AgentAction;

export interface ArenaClientOptions {
  /** WebSocket URL, e.g. "ws://localhost:3000/ws/agent" */
  serverUrl: string;
  /** Agent display name (max 32 chars) */
  name: string;
  /** The decision function called each tick */
  brain: AgentBrain;
  /** Called when match ends */
  onMatchEnd?: (winner: AgentId | null, reason: string) => void;
  /** Called on protocol errors */
  onError?: (error: string) => void;
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
        console.log(
          `[${this.options.name}] Assigned as Robot ${this.agentId}. Waiting for match...`
        );
        break;
      }

      case "tick": {
        if (this.agentId === null) return;
        const matchPhase = msg.matchPhase as MatchPhase;
        if (matchPhase !== "active") return;

        const tick = msg.tick as number;
        const robots = msg.robots as WorldState["robots"];

        // Reconstruct WorldState for the brain
        const worldState: WorldState = {
          tick,
          elapsed: tick / TICK_RATE,
          robots,
          matchPhase,
        };

        // Call the brain to decide action
        const action = this.options.brain(this.agentId, worldState);

        // Send action back to server
        this.ws?.send(
          JSON.stringify({
            type: "action",
            tick,
            action,
          })
        );
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
