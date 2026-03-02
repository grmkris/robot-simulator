// ═══════════════════════════════════════════════
// GridRoyale — Streamable HTTP MCP Server
//
// Push-based model: after queue, the server pushes
// observations via SSE logging notifications on
// every decision tick. step() is fire-and-forget.
// ═══════════════════════════════════════════════

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { GameManager, GameEvent } from "../game/game-manager.js";
import type { AppDatabase } from "../db/client.js";
import { agentStats } from "../db/schema.js";
import { desc } from "drizzle-orm";
import { generateLlmTxt } from "../routes/api.js";
import { formatObservation } from "./format.js";

// ── Per-session state ──

interface McpPlayerSession {
  token: string;
  playerId: string;
  playerName: string;
}

interface McpSessionEntry {
  transport: WebStandardStreamableHTTPServerTransport;
  server: McpServer;
  playerSession?: McpPlayerSession;
}

// ── Session tracking (module-level for handler closure) ──

const sessions = new Map<string, McpSessionEntry>();

// ── Factory ──

export function createMcpHandler(
  gm: GameManager,
  db: AppDatabase,
): (req: Request) => Promise<Response> {

  function cleanupSession(sessionId: string): void {
    const entry = sessions.get(sessionId);
    if (entry?.playerSession) {
      try { gm.unregisterObserver(entry.playerSession.playerId); } catch { /* already removed */ }
      try { gm.leave(entry.playerSession.token); } catch { /* already left */ }
    }
    sessions.delete(sessionId);
    console.log(`[MCP] Session ${sessionId.slice(0, 8)}… cleaned up`);
  }

  function createMcpServerWithTools(): McpServer {
    const server = new McpServer(
      { name: "gridroyale", version: "7.1.0" },
      { capabilities: { logging: {} } },
    );

    // ── Tool: rules ──

    server.tool(
      "gridroyale_rules",
      "Read the rules and strategy guide for GridRoyale. Call this FIRST before playing.",
      {},
      async () => {
        const text = generateLlmTxt(gm);
        return { content: [{ type: "text" as const, text }] };
      },
    );

    // ── Tool: queue ──

    server.tool(
      "gridroyale_queue",
      `Join a GridRoyale game. Choose a unique name. You'll wait in the lobby until 2+ players are ready, then the game starts automatically after a 10-second countdown.`,
      {
        name: z.string().min(1).max(20).describe("Your bot name (unique, 1-20 chars)"),
      },
      async ({ name }, extra) => {
        const sid = extra.sessionId;
        if (!sid) {
          return { content: [{ type: "text" as const, text: "Internal error: no MCP session" }] };
        }

        const entry = sessions.get(sid);
        if (!entry) {
          return { content: [{ type: "text" as const, text: "Internal error: session not found" }] };
        }

        if (entry.playerSession) {
          return {
            content: [{ type: "text" as const, text: `Already in a session as "${entry.playerSession.playerName}". Use gridroyale_leave first.` }],
          };
        }

        const result = gm.queue(name);
        if ("error" in result) {
          return { content: [{ type: "text" as const, text: `Failed to queue: ${result.error}` }] };
        }

        // Store player session
        entry.playerSession = {
          token: result.token,
          playerId: result.playerId,
          playerName: name,
        };

        // Register push observer — game events are pushed via SSE logging notifications
        gm.registerObserver(result.playerId, (event: GameEvent) => {
          try {
            const formatted = formatObservation(event.data, name, result.playerId);
            const prefix = event.type === "game_start" ? "🎮 GAME STARTED!\n\n"
              : event.type === "game_over" ? "🏁 GAME OVER!\n\n"
              : event.type === "lobby" ? "📋 LOBBY UPDATE\n\n"
              : "";
            server.sendLoggingMessage(
              { level: "info", data: prefix + formatted },
              sid,
            );
          } catch {
            // Client disconnected — will be cleaned up
          }
        });

        return {
          content: [{
            type: "text" as const,
            text: [
              `Joined as "${name}" (id: ${result.playerId})`,
              "",
              "You're in the lobby. The game starts when 2+ players join (10s countdown).",
              "",
              "Now call `gridroyale_step` repeatedly in a loop:",
              "- During lobby: call with no action to poll for game start",
              "- During game: call with your action (MOVE/DASH/SHOOT/PICKUP/NOOP) + direction",
              "- Each step blocks until the next decision tick (~0.5s) and returns your observation",
              "- Keep calling until the game ends (status: finished)",
            ].join("\n"),
          }],
        };
      },
    );

    // ── Tool: step (blocking — waits for next decision tick) ──

    server.tool(
      "gridroyale_step",
      `Submit your action and receive the next game observation. This is the main gameplay loop — call it repeatedly.

Actions:
- MOVE: Move 1 tile in direction (N/E/S/W)
- DASH: Move 2 tiles, costs 30 stamina, 8-tick cooldown
- SHOOT: Fire projectile in direction, costs 1 ammo, 2-tick cooldown
- PICKUP: Collect item on your tile
- NOOP: Do nothing (or omit action entirely)

The call blocks ~0.5s until the next decision tick, then returns your fog-filtered observation.`,
      {
        action: z
          .enum(["MOVE", "DASH", "SHOOT", "PICKUP", "NOOP"])
          .optional()
          .describe("Action to take this turn (default: NOOP)"),
        direction: z
          .enum(["N", "E", "S", "W"])
          .optional()
          .describe("Direction for MOVE/DASH/SHOOT (required for those actions)"),
      },
      async ({ action, direction }, extra) => {
        const sid = extra.sessionId;
        const entry = sid ? sessions.get(sid) : undefined;
        const ps = entry?.playerSession;
        if (!ps) {
          return { content: [{ type: "text" as const, text: "Not in a game. Call gridroyale_queue first." }] };
        }

        // Build action payload
        const actionPayload: { t: string; dir?: string } | undefined =
          action && action !== "NOOP" ? { t: action, dir: direction } : undefined;

        // Blocking step: submit action, wait for next decision tick, return observation
        const result = await gm.step(ps.token, actionPayload ?? undefined);

        if (!result) {
          return { content: [{ type: "text" as const, text: "No observation available. You may not be in a game." }] };
        }

        // Format the observation
        const formatted = formatObservation(result, ps.playerName, ps.playerId);
        return { content: [{ type: "text" as const, text: formatted }] };
      },
    );

    // ── Tool: observe ──

    server.tool(
      "gridroyale_observe",
      "Get your current game observation without submitting an action. Useful to check the state before deciding.",
      {},
      async (_args, extra) => {
        const sid = extra.sessionId;
        const entry = sid ? sessions.get(sid) : undefined;
        const ps = entry?.playerSession;
        if (!ps) {
          return { content: [{ type: "text" as const, text: "Not in a game. Call gridroyale_queue first." }] };
        }

        const obs = gm.observe(ps.token);
        if (!obs) return { content: [{ type: "text" as const, text: "No observation available." }] };

        const formatted = formatObservation(obs, ps.playerName, ps.playerId);
        return { content: [{ type: "text" as const, text: formatted }] };
      },
    );

    // ── Tool: leave ──

    server.tool(
      "gridroyale_leave",
      "Leave the current game or lobby. Use this to forfeit or reset your session.",
      {},
      async (_args, extra) => {
        const sid = extra.sessionId;
        const entry = sid ? sessions.get(sid) : undefined;
        const ps = entry?.playerSession;
        if (!ps) {
          return { content: [{ type: "text" as const, text: "Not in a game." }] };
        }

        // Unregister observer first
        gm.unregisterObserver(ps.playerId);
        gm.leave(ps.token);
        const name = ps.playerName;
        entry!.playerSession = undefined;
        return { content: [{ type: "text" as const, text: `Left the game as "${name}".` }] };
      },
    );

    // ── Tool: leaderboard ──

    server.tool(
      "gridroyale_leaderboard",
      "View the current Elo leaderboard rankings.",
      {},
      async () => {
        const rows = db.select().from(agentStats).orderBy(desc(agentStats.elo)).limit(50).all();
        if (!rows || rows.length === 0) {
          return { content: [{ type: "text" as const, text: "No agents ranked yet." }] };
        }

        const lines = ["## Leaderboard", ""];
        for (let i = 0; i < rows.length; i++) {
          const e = rows[i];
          const gamesPlayed = e.wins + e.losses;
          const winRate = gamesPlayed > 0 ? Math.round((e.wins / gamesPlayed) * 100) : 0;
          lines.push(`#${i + 1} ${e.displayName} — Elo ${Math.round(e.elo)} (${e.wins}W/${e.losses}L, ${winRate}%)`);
        }
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      },
    );

    return server;
  }

  // ── Request Handler ──

  return async function handleMcpRequest(req: Request): Promise<Response> {
    const method = req.method;

    if (method === "POST") {
      // Pre-parse body (can only consume req.json() once)
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const sessionId = req.headers.get("mcp-session-id");

      if (sessionId && sessions.has(sessionId)) {
        // Existing session — route to its transport
        return sessions.get(sessionId)!.transport.handleRequest(req, { parsedBody: body });
      }

      if (!sessionId && isInitializeRequest(body)) {
        // New session — create transport + server pair
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          onsessioninitialized: (sid) => {
            const server = mcpServer;
            sessions.set(sid, { transport, server });
            console.log(`[MCP] New session: ${sid.slice(0, 8)}…`);
          },
          onsessionclosed: (sid) => {
            cleanupSession(sid);
          },
        });

        transport.onclose = () => {
          if (transport.sessionId) {
            cleanupSession(transport.sessionId);
          }
        };

        const mcpServer = createMcpServerWithTools();
        await mcpServer.connect(transport);

        return transport.handleRequest(req, { parsedBody: body });
      }

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid session ID" },
          id: null,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    if (method === "GET") {
      // SSE stream — persistent connection for push notifications
      const sessionId = req.headers.get("mcp-session-id");
      if (!sessionId || !sessions.has(sessionId)) {
        return new Response("Invalid or missing session ID", { status: 400 });
      }
      return sessions.get(sessionId)!.transport.handleRequest(req);
    }

    if (method === "DELETE") {
      const sessionId = req.headers.get("mcp-session-id");
      if (!sessionId || !sessions.has(sessionId)) {
        return new Response("Invalid or missing session ID", { status: 400 });
      }
      return sessions.get(sessionId)!.transport.handleRequest(req);
    }

    return new Response("Method not allowed", { status: 405 });
  };
}
