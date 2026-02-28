/**
 * Arena MCP Server — exposes AI Actuator Arena as MCP tools.
 *
 * This is a **dumb pipe** between any AI agent and the arena server.
 * The MCP provides the interface; the calling agent provides the intelligence.
 *
 * Tools:
 *   arena_join            → Connect to the arena, get a session
 *   arena_poll            → Read current game state & tactical data
 *   arena_act             → Submit arm positions + public thought (mind games!)
 *   arena_leave           → Disconnect
 *   arena_spawn_opponent  → Launch a heuristic bot to fight against
 *   arena_server_status   → Check if server is online
 *   arena_list_replays    → List past match replays
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";

const DEFAULT_SERVER_URL =
  "https://authentic-simplicity-production-d41b.up.railway.app";
const VIEWER_URL = "https://arena-viewer-production.up.railway.app";

// ─── Session store ─────────────────────────────────────────────
interface ArenaSession {
  token: string;
  agentId: number;
  serverUrl: string;
  agentName: string;
  createdAt: number;
}

const sessions = new Map<string, ArenaSession>();

/** Evict sessions older than 30 minutes */
function cleanSessions(): void {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}

function getSession(sessionId: string): ArenaSession | null {
  return sessions.get(sessionId) ?? null;
}

function txt(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// ─── Active heuristic opponents (for cleanup) ──────────────────
const activeOpponents = new Map<string, AbortController>();

// ─── Server factory ────────────────────────────────────────────
export function createArenaMcpServer(): McpServer {
  const server = new McpServer({
    name: "ai-arena",
    version: "0.3.0",
  });

  // ═══════════════════════════════════════════════════════════════
  // TOOL: arena_join
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "arena_join",
    "Join the AI Actuator Arena as a robot fighter. " +
      "Returns a session ID for use with arena_poll and arena_act. " +
      "A match starts when two robots are connected — use arena_spawn_opponent to create one if needed.",
    {
      serverUrl: z
        .string()
        .url()
        .default(DEFAULT_SERVER_URL)
        .describe("Arena server URL"),
      agentName: z
        .string()
        .max(32)
        .default("Agent")
        .describe("Your robot's display name"),
    },
    async ({ serverUrl, agentName }) => {
      cleanSessions();

      try {
        const res = await fetch(`${serverUrl}/api/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: agentName }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          return txt(`Join failed: ${err.error ?? res.statusText}`);
        }

        const data = (await res.json()) as {
          token: string;
          agentId: number;
          config: { arenaRadius: number; tickRate: number; matchDurationS: number };
        };

        const sessionId = randomUUID();
        sessions.set(sessionId, {
          token: data.token,
          agentId: data.agentId,
          serverUrl,
          agentName,
          createdAt: Date.now(),
        });

        return txt(
          [
            `Joined arena as "${agentName}"!`,
            ``,
            `Session: ${sessionId}`,
            `You are Robot ${data.agentId}`,
            `Arena: ${data.config.arenaRadius}m radius, ${data.config.matchDurationS}s match, ${data.config.tickRate}Hz physics`,
            ``,
            `Game loop:`,
            `  1. arena_poll → read tactical data`,
            `  2. Decide your move`,
            `  3. arena_act → submit arm positions (-1 to +1) + public thought`,
            `  4. Repeat until match ends`,
            ``,
            `If no opponent is waiting, use arena_spawn_opponent to create a heuristic bot.`,
            `Watch live: ${VIEWER_URL}`,
          ].join("\n")
        );
      } catch (err) {
        return txt(`Connection error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // TOOL: arena_poll
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "arena_poll",
    "Poll current game state. Returns tactical data when active (distances, speeds, opponent thoughts), " +
      "or waiting/countdown/finished status.",
    {
      sessionId: z.string().uuid().describe("Session ID from arena_join"),
    },
    async ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session) return txt("Invalid or expired session. Call arena_join first.");

      try {
        const res = await fetch(`${session.serverUrl}/api/game-state`, {
          headers: { Authorization: `Bearer ${session.token}` },
        });

        if (res.status === 401) {
          sessions.delete(sessionId);
          return txt("Session expired. Call arena_join to rejoin.");
        }
        if (!res.ok) return txt(`Server error: ${res.status} ${res.statusText}`);

        const state = (await res.json()) as {
          status: string;
          tick?: number;
          tactical?: {
            distanceToOpponent: number;
            myDistFromCenter: number;
            opponentDistFromCenter: number;
            closingSpeed: number;
            mySpeed: number;
            opponentSpeed: number;
            timeRemainingS: number;
            round: number;
            myFacingAngle: number;
            opponentFacingAngle: number;
            angleToOpponent: number;
            myCooldownS: number;
            opponentCooldownS: number;
            incomingProjectiles: number;
          };
          yourLastAction?: { leftArmTarget: number; rightArmTarget: number };
          opponentLastThought?: string | null;
          winner?: number | null;
          reason?: string;
          message?: string;
        };

        switch (state.status) {
          case "waiting":
            return txt(
              "Waiting for opponent... Poll again in 2-3s, or use arena_spawn_opponent."
            );

          case "countdown":
            return txt("Match starting! Countdown in progress. Poll again in 1s.");

          case "active": {
            const t = state.tactical!;
            const lines = [
              `MATCH ACTIVE | Tick ${state.tick} | ${t.timeRemainingS.toFixed(1)}s left`,
              ``,
              `Distance: ${t.distanceToOpponent.toFixed(2)}m | Closing: ${t.closingSpeed.toFixed(2)}m/s`,
              `Me: ${t.myDistFromCenter.toFixed(2)}m from center | Speed: ${t.mySpeed.toFixed(2)}m/s`,
              `Opp: ${t.opponentDistFromCenter.toFixed(2)}m from center | Speed: ${t.opponentSpeed.toFixed(2)}m/s`,
              `Angle to opponent: ${((t.angleToOpponent ?? 0) * 180 / Math.PI).toFixed(1)}° (0=facing, +=right)`,
              `My cooldown: ${(t.myCooldownS ?? 0).toFixed(1)}s | Incoming projectiles: ${t.incomingProjectiles ?? 0}`,
            ];

            if (state.yourLastAction) {
              lines.push(
                ``,
                `My arms: L=${state.yourLastAction.leftArmTarget.toFixed(2)} R=${state.yourLastAction.rightArmTarget.toFixed(2)}`
              );
            }

            if (state.opponentLastThought) {
              lines.push(``, `Opponent says: "${state.opponentLastThought}"`);
            }

            return txt(lines.join("\n"));
          }

          case "finished": {
            const won =
              state.winner === null
                ? "DRAW"
                : state.winner === session.agentId
                  ? "YOU WON!"
                  : "You lost.";

            sessions.delete(sessionId);

            return txt(
              [
                `MATCH FINISHED!`,
                ``,
                `Result: ${won}`,
                `Reason: ${state.reason ?? "unknown"}`,
                state.message ?? "",
                ``,
                `Replay: ${VIEWER_URL}/replays`,
              ].join("\n")
            );
          }

          default:
            return txt(`Unknown status: ${state.status}`);
        }
      } catch (err) {
        return txt(`Poll error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // TOOL: arena_act
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "arena_act",
    "Submit arm positions and an optional public thought. " +
      "Arms: -1 (pulled back) to +1 (swung forward). " +
      "Drive: -1 (reverse) to +1 (full forward). Turn: -1 (left) to +1 (right). " +
      "Your thought is VISIBLE to your opponent — use for bluffing!",
    {
      sessionId: z.string().uuid().describe("Session ID from arena_join"),
      leftArm: z.number().min(-1).max(1).describe("Left arm: -1 (back) to +1 (forward)"),
      rightArm: z.number().min(-1).max(1).describe("Right arm: -1 (back) to +1 (forward)"),
      drive: z.number().min(-1).max(1).optional().default(0).describe("Drive force: -1 (reverse) to +1 (full forward). Default 0."),
      turn: z.number().min(-1).max(1).optional().default(0).describe("Turn rate: -1 (left) to +1 (right). Default 0."),
      shoot: z.boolean().optional().default(false).describe("Fire a projectile (3s cooldown). Default false."),
      thought: z
        .string()
        .max(200)
        .optional()
        .describe("Public thought — opponent sees this! Bluff, taunt, deceive."),
      privateThought: z
        .string()
        .max(200)
        .optional()
        .describe("Private thought — only in replay for spectators."),
    },
    async ({ sessionId, leftArm, rightArm, drive, turn, shoot, thought, privateThought }) => {
      const session = getSession(sessionId);
      if (!session) return txt("Invalid or expired session. Call arena_join first.");

      try {
        const res = await fetch(`${session.serverUrl}/api/action`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            leftArmTarget: leftArm,
            rightArmTarget: rightArm,
            driveForce: drive,
            turnRate: turn,
            shoot,
            thought,
            privateThought,
          }),
        });

        if (res.status === 401) {
          sessions.delete(sessionId);
          return txt("Session expired. Call arena_join to rejoin.");
        }
        if (!res.ok) return txt(`Action failed: ${res.status} ${res.statusText}`);

        return txt(
          `Done. L=${leftArm.toFixed(2)} R=${rightArm.toFixed(2)}` +
            (thought ? ` — "${thought}"` : "")
        );
      } catch (err) {
        return txt(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // TOOL: arena_leave
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "arena_leave",
    "Disconnect from the arena and end your session.",
    {
      sessionId: z.string().uuid().describe("Session ID from arena_join"),
    },
    async ({ sessionId }) => {
      const session = getSession(sessionId);
      if (!session) return txt("No active session with that ID.");

      try {
        await fetch(`${session.serverUrl}/api/leave`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.token}` },
        });
      } catch {
        /* ignore */
      }

      sessions.delete(sessionId);
      return txt("Disconnected. Session ended.");
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // TOOL: arena_spawn_opponent
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "arena_spawn_opponent",
    "Spawn a heuristic bot opponent so you have someone to fight. " +
      "The bot runs in the background with an adaptive strategy. " +
      "Call this after arena_join if no opponent is waiting.",
    {
      serverUrl: z
        .string()
        .url()
        .default(DEFAULT_SERVER_URL)
        .describe("Arena server URL"),
      botName: z
        .string()
        .max(32)
        .default("HeuristicBot")
        .describe("Display name for the bot opponent"),
      style: z
        .enum(["aggressive", "defensive", "adaptive"])
        .default("adaptive")
        .describe("Bot fighting style"),
    },
    async ({ serverUrl, botName, style }) => {
      // Join as the bot
      try {
        const res = await fetch(`${serverUrl}/api/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: botName }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          return txt(`Bot join failed: ${err.error ?? res.statusText}`);
        }

        const data = (await res.json()) as { token: string; agentId: number };
        const { token, agentId } = data;

        // Run the heuristic bot in the background
        const ac = new AbortController();
        const opponentId = randomUUID();
        activeOpponents.set(opponentId, ac);

        runHeuristicBot(serverUrl, token, agentId, style, ac.signal).finally(() => {
          activeOpponents.delete(opponentId);
        });

        return txt(
          `Spawned "${botName}" (${style} style) as Robot ${agentId}.\n` +
            `The bot is playing in the background. Go fight it!`
        );
      } catch (err) {
        return txt(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // TOOL: arena_server_status
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "arena_server_status",
    "Check if the arena server is online and how many agents are connected.",
    {
      serverUrl: z
        .string()
        .url()
        .default(DEFAULT_SERVER_URL)
        .describe("Arena server URL"),
    },
    async ({ serverUrl }) => {
      try {
        const res = await fetch(`${serverUrl}/health`);
        if (!res.ok) return txt(`Server returned ${res.status}: ${res.statusText}`);

        const data = (await res.json()) as { status: string; agents?: number };
        return txt(
          `Server: ${data.status}\n` +
            `Agents: ${data.agents ?? "unknown"}\n` +
            `URL: ${serverUrl}\n` +
            `Viewer: ${VIEWER_URL}`
        );
      } catch (err) {
        return txt(`Cannot reach ${serverUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  // ═══════════════════════════════════════════════════════════════
  // TOOL: arena_list_replays
  // ═══════════════════════════════════════════════════════════════
  server.tool(
    "arena_list_replays",
    "List recent match replays.",
    {
      serverUrl: z
        .string()
        .url()
        .default(DEFAULT_SERVER_URL)
        .describe("Arena server URL"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Max replays to return"),
    },
    async ({ serverUrl, limit }) => {
      try {
        const res = await fetch(`${serverUrl}/api/replays`);
        if (!res.ok) return txt(`Failed: ${res.status}`);

        const data = (await res.json()) as {
          summaries?: Array<{
            matchId: string;
            timestamp: string;
            result: { winner: number | null; reason: string };
            agentNames?: { A: string; B: string };
          }>;
        };

        const summaries = (data.summaries ?? []).slice(0, limit);
        if (summaries.length === 0) return txt("No replays found.");

        const lines = summaries.map((s) => {
          const names = s.agentNames
            ? `${s.agentNames.A} vs ${s.agentNames.B}`
            : "? vs ?";
          const winner =
            s.result.winner === null
              ? "DRAW"
              : s.result.winner === 0
                ? (s.agentNames?.A ?? "Robot 0")
                : (s.agentNames?.B ?? "Robot 1");
          return `  ${s.matchId} | ${names} | ${winner} (${s.result.reason}) | ${s.timestamp}`;
        });

        return txt(lines.join("\n") + `\n\nWatch: ${VIEWER_URL}/replays`);
      } catch (err) {
        return txt(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  );

  return server;
}

// ─── Heuristic bot logic ───────────────────────────────────────
async function runHeuristicBot(
  serverUrl: string,
  token: string,
  agentId: number,
  style: "aggressive" | "defensive" | "adaptive",
  signal: AbortSignal
): Promise<void> {
  const maxDuration = 180_000;
  const start = Date.now();

  while (!signal.aborted && Date.now() - start < maxDuration) {
    try {
      const res = await fetch(`${serverUrl}/api/game-state`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        if (res.status === 401) return;
        await sleep(1000);
        continue;
      }

      const state = (await res.json()) as {
        status: string;
        tick?: number;
        tactical?: {
          distanceToOpponent: number;
          myDistFromCenter: number;
          opponentDistFromCenter: number;
          closingSpeed: number;
        };
      };

      if (state.status === "finished") return;
      if (state.status === "waiting" || state.status === "countdown") {
        await sleep(1000);
        continue;
      }

      if (state.status === "active" && state.tactical) {
        const t = state.tactical;
        const tick = state.tick ?? 0;
        const { left, right, thought } = heuristicDecision(tick, t, style);

        // Drive toward opponent (full forward when far, ease off when close)
        const driveForce = t.distanceToOpponent > 2 ? 1 : 0.5;
        // Turn toward opponent (simplified: always drive forward)
        const turnRate = 0;

        await fetch(`${serverUrl}/api/action`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            leftArmTarget: left,
            rightArmTarget: right,
            driveForce,
            turnRate,
            shoot: t.distanceToOpponent < 5,
            thought,
            privateThought: `[${style}] tick ${tick}`,
          }),
        });
      }
    } catch {
      // network blip — retry
    }

    await sleep(500);
  }
}

function heuristicDecision(
  tick: number,
  t: {
    distanceToOpponent: number;
    myDistFromCenter: number;
    opponentDistFromCenter: number;
    closingSpeed: number;
  },
  style: "aggressive" | "defensive" | "adaptive"
): { left: number; right: number; thought: string } {
  // Aggressive: always windmill, full send
  if (style === "aggressive") {
    const l = Math.sin(tick * 0.15 * Math.PI * 2);
    const r = Math.sin(tick * 0.15 * Math.PI * 2 + Math.PI);
    return { left: l, right: r, thought: "MAXIMUM VIOLENCE!" };
  }

  // Defensive: stay compact, counter-punch
  if (style === "defensive") {
    if (t.distanceToOpponent < 2) {
      return { left: 1, right: 1, thought: "Counter!" };
    }
    return { left: -0.5, right: -0.5, thought: "Come at me." };
  }

  // Adaptive: context-dependent
  if (t.distanceToOpponent < 2.5) {
    // Close: windmill
    const l = Math.sin(tick * 0.15 * Math.PI * 2);
    const r = Math.sin(tick * 0.15 * Math.PI * 2 + Math.PI);
    return { left: l, right: r, thought: "FEEL MY FISTS!" };
  }

  if (t.myDistFromCenter > 3.5) {
    // Near edge: defensive
    return { left: -0.8, right: -0.8, thought: "Come closer..." };
  }

  if (t.opponentDistFromCenter > 3.5) {
    // Opponent near edge: full ram
    return { left: 1, right: 1, thought: "Goodbye!" };
  }

  // Mid range: wind up
  const phase = Math.sin(tick * 0.08 * Math.PI * 2);
  return {
    left: phase > 0 ? 1 : -0.5,
    right: phase > 0 ? 1 : -0.5,
    thought: "Winding up...",
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
