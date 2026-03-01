/**
 * ArenaHttpClient — HTTP-based agent SDK for AI Actuator Arena.
 *
 * Instead of a WebSocket, agents interact via simple HTTP endpoints:
 *   POST /api/join       → register, get a Bearer token
 *   GET  /api/game-state → poll current state
 *   POST /api/action     → submit arm targets + thoughts
 *   POST /api/leave      → voluntarily disconnect
 *
 * The brain function is the same as the WebSocket client — existing
 * brain implementations work without any changes.
 *
 * Usage:
 *   const client = new ArenaHttpClient({
 *     serverUrl: "http://localhost:3000",
 *     name: "MyBot",
 *     brain: async (agentId, state, context) => ({
 *       leftArmTarget: 0.5,
 *       rightArmTarget: -0.3,
 *       thought: "Watch out!",
 *     }),
 *     pollIntervalMs: 500,
 *   });
 *   await client.connect();
 */
import type {
  AgentAction,
  AgentId,
  WorldState,
  GameStateResponse,
  TacticalContext,
  RobotBuild,
} from "@ai-arena/protocol";
import { TICK_RATE } from "@ai-arena/protocol";
import type { DecisionContext } from "./client.js";

/**
 * The brain function an agent author implements.
 * Same signature as the WebSocket client — existing brains work unchanged.
 */
export type AgentBrain = (
  agentId: AgentId,
  state: WorldState,
  context?: DecisionContext
) => AgentAction | Promise<AgentAction>;

export interface ArenaHttpClientOptions {
  /** Server base URL, e.g. "http://localhost:3000" */
  serverUrl: string;
  /** Agent display name (max 32 chars) */
  name: string;
  /** The decision function — sync or async */
  brain: AgentBrain;
  /** Polling interval in milliseconds (default: 500ms, LLM agents: 1000-3000ms) */
  pollIntervalMs?: number;
  /** Called when match ends */
  onMatchEnd?: (winner: AgentId | null, reason: string) => void;
  /** Called on errors */
  onError?: (error: string) => void;
  /** Robot build configuration (optional, defaults to medium/standard/standard) */
  build?: Partial<RobotBuild>;
}

export class ArenaHttpClient {
  private token: string | null = null;
  private agentId: AgentId | null = null;
  private running = false;
  private readonly options: ArenaHttpClientOptions;
  private readonly pollIntervalMs: number;

  constructor(options: ArenaHttpClientOptions) {
    this.options = options;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  /** Connect to the arena server (join + start poll loop) */
  async connect(): Promise<void> {
    const { serverUrl, name } = this.options;
    console.log(`[${name}] Joining ${serverUrl}...`);

    // POST /api/join
    const joinRes = await fetch(`${serverUrl}/api/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, build: this.options.build }),
    });

    if (!joinRes.ok) {
      const err = await joinRes.json().catch(() => ({ error: joinRes.statusText }));
      const errMsg = (err as { error?: string }).error ?? "Join failed";
      console.error(`[${name}] Join failed: ${errMsg}`);
      this.options.onError?.(errMsg);
      return;
    }

    const joinData = await joinRes.json() as {
      token: string;
      position?: number;
      agentId?: AgentId;
      config: { arenaRadius: number; tickRate: number; matchDurationS: number };
    };

    this.token = joinData.token;
    // agentId is assigned when match starts, not at join time anymore
    this.agentId = joinData.agentId ?? null;
    this.running = true;

    console.log(
      `[${name}] Joined queue (position ${joinData.position ?? "?"}). ` +
      `Arena: radius=${joinData.config.arenaRadius}, ` +
      `tick=${joinData.config.tickRate}Hz, ` +
      `duration=${joinData.config.matchDurationS}s`
    );

    // Start poll loop
    this.pollLoop();
  }

  /** Disconnect from the server */
  async disconnect(): Promise<void> {
    this.running = false;

    if (this.token) {
      try {
        await fetch(`${this.options.serverUrl}/api/leave`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.token}` },
        });
      } catch {
        // ignore — might already be disconnected
      }
    }

    console.log(`[${this.options.name}] Disconnected`);
    this.token = null;
    this.agentId = null;
  }

  private async pollLoop(): Promise<void> {
    const { serverUrl, name } = this.options;

    while (this.running && this.token) {
      try {
        // GET /api/game-state
        const res = await fetch(`${serverUrl}/api/game-state`, {
          headers: { Authorization: `Bearer ${this.token}` },
        });

        if (!res.ok) {
          if (res.status === 401) {
            console.log(`[${name}] Token expired or invalid. Stopping.`);
            this.running = false;
            break;
          }
          // Transient error, retry
          await sleep(this.pollIntervalMs);
          continue;
        }

        const state = await res.json() as GameStateResponse;

        switch (state.status) {
          case "queued":
            // In queue, waiting to be matched
            if (state.position !== undefined) {
              console.log(`[${name}] Queue position: ${state.position}/${state.queueSize ?? "?"}`);
            }
            break;

          case "waiting":
          case "countdown":
            // Matched but not started yet, or in countdown
            if (state.you !== undefined && this.agentId === null) {
              this.agentId = state.you;
              console.log(`[${name}] Assigned as Robot ${this.agentId}`);
            }
            break;

          case "active": {
            // Learn agentId from first active state
            if (state.you !== undefined && this.agentId === null) {
              this.agentId = state.you;
              console.log(`[${name}] Assigned as Robot ${this.agentId}`);
            }
            // Build WorldState for the brain
            if (state.robots && state.you !== undefined && state.tick !== undefined) {
              const worldState: WorldState = {
                tick: state.tick,
                elapsed: state.elapsed ?? state.tick / TICK_RATE,
                robots: state.robots,
                projectiles: state.projectiles ?? [],
                matchPhase: "active",
              };

              const context: DecisionContext | undefined = state.tactical
                ? {
                    tactical: state.tactical,
                    currentAction: state.yourLastAction ?? { leftArmTarget: 0, rightArmTarget: 0 },
                    opponentThought: state.opponentLastThought ?? null,
                    round: 0, // No rounds in HTTP mode
                  }
                : undefined;

              // Call brain — supports both sync and async
              try {
                const action = await Promise.resolve(
                  this.options.brain(this.agentId!, worldState, context)
                );

                // POST /api/action
                await fetch(`${serverUrl}/api/action`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.token}`,
                  },
                  body: JSON.stringify(action),
                });
              } catch (err) {
                console.error(`[${name}] Brain error:`, err);
              }
            }
            break;
          }

          case "finished": {
            const winner = state.winner ?? null;
            const reason = state.reason ?? "unknown";
            console.log(
              `[${name}] Match ended: winner=${winner ?? "DRAW"} reason=${reason} — ${state.message ?? ""}`
            );
            this.options.onMatchEnd?.(winner, reason);
            this.running = false;
            break;
          }
        }
      } catch (err) {
        // Network error — retry after interval
        console.error(`[${name}] Poll error:`, err);
      }

      if (this.running) {
        await sleep(this.pollIntervalMs);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
