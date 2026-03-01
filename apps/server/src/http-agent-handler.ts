/**
 * HTTP Agent API routes.
 *
 * Agents interact via simple REST endpoints:
 *   POST /join       → join the queue, get a Bearer token
 *   GET  /game-state → poll current state (heartbeat)
 *   POST /action     → submit arm targets + thoughts
 *   POST /leave      → voluntarily disconnect (from queue or match)
 *
 * Any language can play — just use curl!
 */
import { Hono } from "hono";
import {
  ARENA_RADIUS,
  TICK_RATE,
  MATCH_DURATION_S,
  PROTOCOL_VERSION,
} from "@ai-arena/protocol";
import { JoinRequestSchema, AgentActionSchema } from "@ai-arena/protocol";
import type { MatchManager } from "./match-manager.js";

/** Extract Bearer token from Authorization header */
function extractToken(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

export function createAgentRoutes(matchManager: MatchManager): Hono {
  const app = new Hono();

  // ── POST /join ──
  app.post("/join", async (c) => {
    let body: unknown;
    try {
      const text = await c.req.text();
      body = JSON.parse(text);
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = JoinRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: `Invalid request: ${parsed.error.issues.map((i) => i.message).join(", ")}` },
        400
      );
    }

    const result = matchManager.enqueueAgent(parsed.data.name, parsed.data.build);
    if (!result) {
      return c.json({ error: "Queue is full or name is already taken" }, 409);
    }

    return c.json({
      token: result.token,
      position: result.position,
      build: result.build,
      protocolVersion: PROTOCOL_VERSION,
      config: {
        arenaRadius: ARENA_RADIUS,
        tickRate: TICK_RATE,
        matchDurationS: MATCH_DURATION_S,
      },
    });
  });

  // ── GET /game-state ──
  app.get("/game-state", (c) => {
    const token = extractToken(c);
    if (!token) {
      return c.json({ error: "Missing Authorization: Bearer <token>" }, 401);
    }

    // Check if agent is still in queue
    const queuePos = matchManager.getQueuePosition(token);
    if (queuePos) {
      return c.json({
        status: "queued",
        position: queuePos.position,
        queueSize: queuePos.queueSize,
      });
    }

    // Check if agent is in active match
    const agentId = matchManager.resolveToken(token);
    if (agentId === null) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    const state = matchManager.getGameStateForAgent(agentId);
    return c.json(state);
  });

  // ── POST /action ──
  app.post("/action", async (c) => {
    const token = extractToken(c);
    if (!token) {
      return c.json({ error: "Missing Authorization: Bearer <token>" }, 401);
    }

    const agentId = matchManager.resolveToken(token);
    if (agentId === null) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    let body: unknown;
    try {
      const text = await c.req.text();
      body = JSON.parse(text);
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsed = AgentActionSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: `Invalid action: ${parsed.error.issues.map((i) => i.message).join(", ")}` },
        400
      );
    }

    matchManager.receiveAction(agentId, parsed.data);

    return c.json({
      ok: true,
      tick: matchManager.currentState?.tick ?? 0,
    });
  });

  // ── POST /leave ──
  app.post("/leave", (c) => {
    const token = extractToken(c);
    if (!token) {
      return c.json({ error: "Missing Authorization: Bearer <token>" }, 401);
    }

    const left = matchManager.handleLeaveByToken(token);
    if (!left) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    return c.json({ ok: true });
  });

  return app;
}
