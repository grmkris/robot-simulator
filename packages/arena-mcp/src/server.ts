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
  build?: { chassis?: string; arms?: string; weapon?: string };
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
      "A match starts when two robots are connected.",
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
      chassis: z
        .enum(["light", "medium", "heavy"])
        .optional()
        .describe("Chassis type: light (fast, fragile), medium (balanced), heavy (slow, tanky). Default: medium"),
      arms: z
        .enum(["short", "standard", "long"])
        .optional()
        .describe("Arm type: short (fast punches), standard (balanced), long (huge reach). Default: standard"),
      weapon: z
        .enum(["rapid", "standard", "heavy"])
        .optional()
        .describe("Weapon type: rapid (1.8s cooldown, low knockback), standard (3s, medium), heavy (4.5s, devastating). Default: standard"),
    },
    async ({ serverUrl, agentName, chassis, arms, weapon }) => {
      cleanSessions();

      try {
        const build: Record<string, string> = {};
        if (chassis) build.chassis = chassis;
        if (arms) build.arms = arms;
        if (weapon) build.weapon = weapon;

        const res = await fetch(`${serverUrl}/api/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: agentName,
            ...(Object.keys(build).length > 0 ? { build } : {}),
          }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          return txt(`Join failed: ${err.error ?? res.statusText}`);
        }

        const data = (await res.json()) as {
          token: string;
          agentId: number;
          build?: { chassis: string; arms: string; weapon: string };
          config: { arenaRadius: number; tickRate: number; matchDurationS: number };
        };

        const sessionId = randomUUID();
        const resolvedBuild = data.build ?? { chassis: chassis ?? "medium", arms: arms ?? "standard", weapon: weapon ?? "standard" };
        sessions.set(sessionId, {
          token: data.token,
          agentId: data.agentId,
          serverUrl,
          agentName,
          build: resolvedBuild,
          createdAt: Date.now(),
        });

        return txt(
          [
            `Joined arena as "${agentName}"!`,
            ``,
            `Session: ${sessionId}`,
            `Build: ${resolvedBuild.chassis} chassis / ${resolvedBuild.arms} arms / ${resolvedBuild.weapon} weapon`,
            `Arena: ${data.config.arenaRadius}m radius, ${data.config.matchDurationS}s match, ${data.config.tickRate}Hz physics`,
            ``,
            `Build stats:`,
            `  Chassis: ${resolvedBuild.chassis} — ${resolvedBuild.chassis === "light" ? "fast (5.5m/s) but fragile (1.3x knockback)" : resolvedBuild.chassis === "heavy" ? "slow (2.8m/s) but tanky (0.7x knockback)" : "balanced (4m/s, 1x knockback)"}`,
            `  Arms: ${resolvedBuild.arms} — ${resolvedBuild.arms === "short" ? "fast snappy punches, low reach" : resolvedBuild.arms === "long" ? "slow sweeping hits, huge reach" : "balanced reach and speed"}`,
            `  Weapon: ${resolvedBuild.weapon} — ${resolvedBuild.weapon === "rapid" ? "1.8s cooldown, low knockback" : resolvedBuild.weapon === "heavy" ? "4.5s cooldown, devastating knockback" : "3s cooldown, medium knockback"}`,
            ``,
            `Game loop:`,
            `  1. arena_poll → read tactical data`,
            `  2. Decide your move`,
            `  3. arena_act → submit arm positions (-1 to +1) + public thought`,
            `  4. Repeat until match ends`,
            ``,
            `If no opponent is waiting, share the join instructions and wait for another player.`,
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
            myBuild?: { chassis: string; arms: string; weapon: string };
            opponentBuild?: { chassis: string; arms: string; weapon: string };
          };
          yourLastAction?: { leftArmTarget: number; rightArmTarget: number };
          opponentLastThought?: string | null;
          myBuild?: { chassis: string; arms: string; weapon: string };
          opponentBuild?: { chassis: string; arms: string; weapon: string };
          winner?: number | null;
          reason?: string;
          message?: string;
          position?: number;
          queueSize?: number;
        };

        switch (state.status) {
          case "waiting":
            return txt(
              "Waiting for opponent... Poll again in 2-3s."
            );

          case "countdown":
            return txt("Match starting! Countdown in progress. Poll again in 1s.");

          case "queued":
            return txt(
              `In queue (position ${state.position ?? "?"}/${state.queueSize ?? "?"}). Waiting for opponent... Poll again in 2-3s.`
            );

          case "active": {
            const t = state.tactical!;
            const myBuild = state.myBuild ?? t.myBuild;
            const oppBuild = state.opponentBuild ?? t.opponentBuild;
            const lines = [
              `MATCH ACTIVE | Tick ${state.tick} | ${t.timeRemainingS.toFixed(1)}s left`,
              ``,
              `My build: ${myBuild ? `${myBuild.chassis}/${myBuild.arms}/${myBuild.weapon}` : "unknown"}`,
              `Opponent build: ${oppBuild ? `${oppBuild.chassis}/${oppBuild.arms}/${oppBuild.weapon}` : "unknown"}`,
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

