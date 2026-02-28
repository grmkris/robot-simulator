/**
 * AI Actuator Arena — Server Entry Point
 *
 * Hono HTTP + WebSocket server running on Bun.
 * Agent API: HTTP endpoints (/api/join, /api/game-state, /api/action, /api/leave)
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

// Initialize Rapier WASM at startup
console.log("[Server] Initializing Rapier3D WASM...");
await initPhysics();
console.log("[Server] Rapier3D ready.");

// Create match manager (single arena instance for MVP)
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
  c.json({ status: "ok", agents: matchManager.agentCount })
);

// Current match state (REST fallback for viewers)
app.get("/api/match/state", (c) => {
  const state = matchManager.currentState;
  if (state) return c.json(state);
  return c.json({ error: "No active match" }, 404);
});

// Replay endpoints
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
