/**
 * GridRoyale — Server Entry Point
 *
 * Single Bun.serve() instance with:
 *   - Static HTML SPA via Bun's native HTML import
 *   - REST API (bot endpoints + lobby + data)
 *   - SSE streaming (bot observations)
 *   - WebSocket spectator stream (/ws/spectator)
 *   - SQLite via Drizzle ORM (WAL mode, auto schema push)
 */

import index from "./ui/index.html";
import { env } from "./env.js";
import { createDb } from "./db/client.js";
import { GameManager } from "./game/game-manager.js";
import { createApiRoutes, handleReplayById } from "./routes/api.js";
import { createMcpHandler } from "./mcp/streamable-http.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// ── Ensure data directories exist ──

mkdirSync(dirname(env.DATABASE_PATH), { recursive: true });
if (env.REPLAY_DIR) {
  mkdirSync(env.REPLAY_DIR, { recursive: true });
}

// ── Database ──

console.log("[Server] Opening SQLite database:", env.DATABASE_PATH);
const db = createDb({ databasePath: env.DATABASE_PATH });

// Push schema — create tables that don't exist yet
db.$client.run(`
  CREATE TABLE IF NOT EXISTS agent_stats (
    agent_name   TEXT    PRIMARY KEY,
    display_name TEXT    NOT NULL,
    wins         INTEGER NOT NULL DEFAULT 0,
    losses       INTEGER NOT NULL DEFAULT 0,
    draws        INTEGER NOT NULL DEFAULT 0,
    elo          REAL    NOT NULL DEFAULT 1000,
    last_seen    INTEGER,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at   INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
`);

db.$client.run(`
  CREATE TABLE IF NOT EXISTS games (
    id            TEXT    PRIMARY KEY,
    seed          INTEGER NOT NULL,
    player_count  INTEGER NOT NULL,
    winner_id     TEXT,
    winner_name   TEXT,
    reason        TEXT    NOT NULL,
    total_ticks   INTEGER NOT NULL,
    duration_s    REAL    NOT NULL,
    timestamp     INTEGER NOT NULL,
    created_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at    INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
`);

db.$client.run(`
  CREATE TABLE IF NOT EXISTS game_players (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id        TEXT    NOT NULL REFERENCES games(id),
    player_id      TEXT    NOT NULL,
    player_name    TEXT    NOT NULL,
    placement      INTEGER NOT NULL,
    kills          INTEGER NOT NULL DEFAULT 0,
    damage_dealt   INTEGER NOT NULL DEFAULT 0,
    survival_ticks INTEGER NOT NULL DEFAULT 0,
    elo_change     REAL,
    created_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
    updated_at     INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
  );
`);

db.$client.run(`
  CREATE TABLE IF NOT EXISTS intents (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id   TEXT    NOT NULL REFERENCES games(id),
    tick      INTEGER NOT NULL,
    player_id TEXT    NOT NULL,
    action    TEXT    NOT NULL,
    direction TEXT
  );
`);

db.$client.run(`
  CREATE INDEX IF NOT EXISTS idx_intents_game_tick ON intents(game_id, tick);
`);

db.$client.run(`
  CREATE INDEX IF NOT EXISTS idx_game_players_game ON game_players(game_id);
`);

console.log("[Server] Schema ready.");

// ── Game Manager ──

const gameManager = new GameManager(db);

// ── API Routes ──

const apiRoutes = createApiRoutes(gameManager, db);

// ── MCP Handler ──

const mcpHandler = createMcpHandler(gameManager, db);

// ── CORS headers ──

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const mcpCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

// ── Server ──

const server = Bun.serve({
  port: env.PORT,

  routes: {
    // SPA pages — served by Bun's native HTML bundler
    "/": index,
    "/join": index,
    "/leaderboard": index,
    "/replays": index,

    // All API + data routes
    ...apiRoutes,
  },

  fetch(req, server) {
    const url = new URL(req.url);

    // CORS preflight (MCP needs extra headers)
    if (req.method === "OPTIONS") {
      const headers = url.pathname === "/mcp" ? mcpCorsHeaders : corsHeaders;
      return new Response(null, { status: 204, headers });
    }

    // MCP Streamable HTTP endpoint
    if (url.pathname === "/mcp") {
      return mcpHandler(req).then((response) => {
        // Inject CORS headers into the MCP response
        const newHeaders = new Headers(response.headers);
        for (const [k, v] of Object.entries(mcpCorsHeaders)) {
          if (!newHeaders.has(k)) newHeaders.set(k, v);
        }
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers: newHeaders,
        });
      });
    }

    // WebSocket upgrade — spectator stream
    if (url.pathname === "/ws/spectator") {
      if (server.upgrade(req)) return undefined as unknown as Response;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // API: GET /api/replays/:id — full replay data
    const replayMatch = url.pathname.match(/^\/api\/replays\/([^/]+)$/);
    if (replayMatch && req.method === "GET") {
      return handleReplayById(req, replayMatch[1]!, db);
    }
    if (replayMatch && req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // SPA fallback for /replays/:id
    if (url.pathname.startsWith("/replays/")) {
      return new Response(Bun.file(new URL("./ui/index.html", import.meta.url)));
    }

    return new Response("Not Found", { status: 404 });
  },

  websocket: {
    open(ws) {
      gameManager.addSpectator(ws);
    },
    close(ws) {
      gameManager.removeSpectator(ws);
    },
    message() {
      // Spectators are read-only
    },
  },

  development: env.NODE_ENV !== "production",
});

// ── Startup Log ──

console.log(`[Server] GridRoyale listening on ${server.url}`);
console.log(`[Server] ── Bot API ──`);
console.log(`[Server]   POST ${server.url}api/queue`);
console.log(`[Server]   POST ${server.url}api/step    (recommended universal loop)`);
console.log(`[Server]   GET  ${server.url}api/observe`);
console.log(`[Server]   POST ${server.url}api/act`);
console.log(`[Server]   POST ${server.url}api/leave`);
console.log(`[Server]   GET  ${server.url}api/stream   (SSE)`);
console.log(`[Server] ── Viewer ──`);
console.log(`[Server]   WS   ws://${server.url.host}/ws/spectator`);
console.log(`[Server] ── Data ──`);
console.log(`[Server]   GET  ${server.url}api/lobby`);
console.log(`[Server]   GET  ${server.url}health`);
console.log(`[Server]   GET  ${server.url}llm.txt`);
console.log(`[Server] ── MCP ──`);
console.log(`[Server]   MCP  ${server.url}mcp  (Streamable HTTP)`);

export { server };
