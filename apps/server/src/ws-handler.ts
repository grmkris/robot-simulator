/**
 * WebSocket route handler — Spectator only.
 *
 * Agent connections now use the HTTP API (see http-agent-handler.ts).
 * This file only handles the /spectator WebSocket endpoint for real-time
 * 3D viewer streaming.
 */
import { Hono } from "hono";
import { upgradeWebSocket } from "hono/bun";
import type { MatchManager } from "./match-manager.js";

export function createWSRoutes(matchManager: MatchManager): Hono {
  const app = new Hono();

  // ── Spectator WebSocket Endpoint ──
  app.get(
    "/spectator",
    upgradeWebSocket(() => ({
      onOpen(_event, ws) {
        matchManager.addSpectator(ws);
      },
      onClose(_event, ws) {
        matchManager.removeSpectator(ws);
      },
      onMessage() {
        // Spectators don't send messages
      },
    }))
  );

  return app;
}
