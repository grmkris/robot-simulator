/**
 * AI Actuator Arena — Server Entry Point
 *
 * Hono HTTP + WebSocket server running on Bun.
 * Agent API: HTTP endpoints (/api/join, /api/game-state, /api/action, /api/leave)
 * Lobby:     REST endpoints (/api/lobby, /api/leaderboard, /api/match-history)
 * Viewer:    WebSocket (/ws/spectator) for real-time 3D streaming
 * Replays:   REST endpoints (/api/replays)
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { websocket } from "hono/bun";
import { initPhysics } from "@ai-arena/sim";
import { MatchManager } from "./match-manager.js";
import { createWSRoutes } from "./ws-handler.js";
import { createAgentRoutes } from "./http-agent-handler.js";
import { loadReplay, listReplaySummaries } from "./replay-store.js";
import { initDb, getLeaderboard, getMatchHistory } from "./db.js";

// Initialize database
console.log("[Server] Initializing SQLite database...");
initDb();

// Initialize Rapier WASM at startup
console.log("[Server] Initializing Rapier3D WASM...");
await initPhysics();
console.log("[Server] Rapier3D ready.");

// Create match manager (single arena instance)
const matchManager = new MatchManager();

// Build Hono app
const app = new Hono();

// CORS for viewer frontend
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST"],
  })
);

// Health check
app.get("/health", (c) =>
  c.json({
    status: "ok",
    agents: matchManager.agentCount,
    queue: matchManager.queueSize,
    matchActive: matchManager.isMatchActive,
  })
);

// Current match state (REST fallback for viewers)
app.get("/api/match/state", (c) => {
  const state = matchManager.currentState;
  if (state) return c.json(state);
  return c.json({ error: "No active match" }, 404);
});

// ── Lobby endpoints ──

app.get("/api/lobby", (c) => {
  return c.json(matchManager.buildLobbyState());
});

app.get("/api/leaderboard", (c) => {
  const limit = Number(c.req.query("limit")) || 50;
  const rows = getLeaderboard(limit);
  const leaderboard = rows.map((r, i) => ({
    rank: i + 1,
    agentName: r.agent_name,
    displayName: r.display_name,
    wins: r.wins,
    losses: r.losses,
    draws: r.draws,
    elo: r.elo,
    matches: r.wins + r.losses + r.draws,
    winRate:
      r.wins + r.losses + r.draws > 0
        ? Math.round((r.wins / (r.wins + r.losses + r.draws)) * 1000) / 10
        : 0,
  }));
  return c.json({ leaderboard });
});

app.get("/api/match-history", (c) => {
  const limit = Number(c.req.query("limit")) || 50;
  const agent = c.req.query("agent");
  const rows = getMatchHistory(limit, agent || undefined);
  const matches = rows.map((r) => ({
    matchId: r.match_id,
    timestamp: r.timestamp,
    agentA: r.agent_a,
    agentB: r.agent_b,
    winner: r.winner,
    reason: r.reason,
    durationS: r.duration_s,
  }));
  return c.json({ matches });
});

// ── Replay endpoints ──

app.get("/api/replays", async (c) => {
  const summaries = await listReplaySummaries();
  const ids = summaries.map((s) => s.matchId);
  return c.json({ replays: ids, summaries });
});

app.get("/api/replays/:id", async (c) => {
  const id = c.req.param("id");
  const replay = await loadReplay(id);
  if (replay) return c.json(replay);
  return c.json({ error: "Replay not found" }, 404);
});

// HTTP Agent API routes
const agentRoutes = createAgentRoutes(matchManager);
app.route("/api", agentRoutes);

// WebSocket routes (spectator only)
const wsRoutes = createWSRoutes(matchManager);
app.route("/ws", wsRoutes);

// ── Start Server ──
const PORT = Number(process.env.PORT) || 3000;

console.log(`[Server] Starting on port ${PORT}...`);
console.log(`[Server] ── Agent HTTP API ──`);
console.log(`[Server]   POST http://localhost:${PORT}/api/join`);
console.log(`[Server]   GET  http://localhost:${PORT}/api/game-state`);
console.log(`[Server]   POST http://localhost:${PORT}/api/action`);
console.log(`[Server]   POST http://localhost:${PORT}/api/leave`);
console.log(`[Server] ── Lobby ──`);
console.log(`[Server]   GET  http://localhost:${PORT}/api/lobby`);
console.log(`[Server]   GET  http://localhost:${PORT}/api/leaderboard`);
console.log(`[Server]   GET  http://localhost:${PORT}/api/match-history`);
console.log(`[Server] ── Viewer ──`);
console.log(`[Server]   WS   ws://localhost:${PORT}/ws/spectator`);
console.log(`[Server] ── Other ──`);
console.log(`[Server]   GET  http://localhost:${PORT}/health`);
console.log(`[Server]   GET  http://localhost:${PORT}/api/replays`);

export default {
  port: PORT,
  fetch: app.fetch,
  websocket,
};
