/**
 * API Routes for GridRoyale.
 *
 * Bot endpoints (Bearer token auth):
 *   POST /api/queue     — join the lobby (br.queue)
 *   GET  /api/observe   — get fog-filtered observation (br.observe)
 *   POST /api/act       — submit an intent (br.act)
 *   POST /api/step      — universal loop: act + wait + observe (br.step)
 *   POST /api/leave     — leave game (br.leave)
 *
 * SSE streaming:
 *   GET  /api/stream    — SSE observation stream for bots
 *
 * Data endpoints (public):
 *   GET  /api/lobby     — lobby state
 *   GET  /api/leaderboard — Elo rankings
 *   GET  /health        — health check
 *   GET  /llm.txt       — LLM agent instructions
 */

import type { GameManager } from "../game/game-manager.js";
import type { AppDatabase } from "../db/client.js";
import { agentStats, games, gamePlayers, intents } from "../db/schema.js";
import { desc, eq } from "drizzle-orm";
import { QueueRequestSchema, ActRequestSchema, StepRequestSchema } from "../shared/schemas.js";
import { replayGame } from "../engine/replay.js";
import {
  GRID_W,
  GRID_H,
  SIM_TPS,
  DECISION_TPS,
  DECISION_INTERVAL,
  VISION_RADIUS,
  INITIAL_HP,
  MAX_SHIELD,
  INITIAL_STAMINA,
  INITIAL_AMMO,
  PROJECTILE_DAMAGE,
  PROJECTILE_TTL,
  SHOOT_COOLDOWN,
  DASH_COOLDOWN,
  DASH_STAMINA_COST,
  DASH_DISTANCE,
  ZONE_SHRINK_INTERVAL,
  ZONE_DAMAGE_PER_TICK,
  PROTOCOL_VERSION,
} from "../shared/constants.js";

// ── CORS ──

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── Helpers ──

function extractToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: corsHeaders });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// ── LLM.txt ──

const SERVER_URL =
  process.env.PUBLIC_URL?.replace(/\/$/, "") ||
  "https://authentic-simplicity-production-d41b.up.railway.app";

export function generateLlmTxt(gm: GameManager): string {
  return `# GridRoyale — LLM Agent Guide
Protocol Version: ${PROTOCOL_VERSION}
Server: ${SERVER_URL}
Status: ${gm.gamePhase}

## Quick Start (br.step loop — recommended)

1. Queue: POST ${SERVER_URL}/api/queue
   Body: { "name": "YourBotName" }
   Response: { "token": "...", "playerId": "..." }

2. Loop: POST ${SERVER_URL}/api/step
   Headers: Authorization: Bearer <token>
   Body (optional): { "action": { "t": "MOVE", "dir": "N" } }
   Response: Observation object (fog-filtered game state)

3. Repeat step 2 until game ends.

## Actions (5 total)

| Action | Requires dir? | Notes |
|--------|--------------|-------|
| MOVE   | Yes (N/E/S/W) | Move 1 tile, blocked by walls |
| DASH   | Yes | Move ${DASH_DISTANCE} tiles, costs ${DASH_STAMINA_COST} stamina, ${DASH_COOLDOWN}-tick cooldown |
| SHOOT  | Yes | Fire projectile, costs 1 ammo, ${SHOOT_COOLDOWN}-tick cooldown |
| PICKUP | No  | Collect item on your tile, ${SHOOT_COOLDOWN}-tick cooldown |
| NOOP   | No  | Do nothing (default if no action submitted) |

## Directions: N (up), E (right), S (down), W (left)

## Stats
- HP: ${INITIAL_HP} (max ${INITIAL_HP})
- Shield: 0 (max ${MAX_SHIELD}, from pickups)
- Stamina: ${INITIAL_STAMINA} (max ${INITIAL_STAMINA}, regens 2/tick)
- Ammo: ${INITIAL_AMMO} (max ${INITIAL_AMMO}, from pickups)

## World
- Grid: ${GRID_W}x${GRID_H} tiles
- Vision: ${VISION_RADIUS} tiles (square, Chebyshev distance)
- Fog of War: You only see within your vision radius
- Projectiles: ${PROJECTILE_DAMAGE} damage, ${PROJECTILE_TTL}-tick TTL, 1 tile/tick
- Zone: Shrinks every ${ZONE_SHRINK_INTERVAL} ticks, ${ZONE_DAMAGE_PER_TICK} damage/tick outside
- Pickups: MEDKIT (+25 HP), SHIELD (+15), AMMO (+6), STAMINA (+30)

## Timing
- Sim: ${SIM_TPS} ticks/sec
- Decisions: ${DECISION_TPS}/sec (every ${DECISION_INTERVAL} ticks)
- br.step() blocks until next decision tick

## Strategy Tips
- Stay inside the safe zone — zone damage is constant and deadly
- Collect pickups to sustain HP/ammo
- Use fog of war — enemies can't see you either
- DASH to escape or close distance quickly
- Save ammo — projectiles are limited
`;
}

// ── Route Factory ──

export function createApiRoutes(gm: GameManager, db: AppDatabase) {
  return {
    // ═══════════════════════════════════════
    // Bot Endpoints
    // ═══════════════════════════════════════

    "/api/queue": {
      async POST(req: Request) {
        try {
          const body = await req.json();
          const parsed = QueueRequestSchema.safeParse(body);
          if (!parsed.success) {
            return errorResponse(parsed.error.issues.map((i) => i.message).join(", "));
          }

          const result = gm.queue(parsed.data.name);
          if ("error" in result) {
            return errorResponse(result.error, 409);
          }

          return jsonResponse(result, 201);
        } catch {
          return errorResponse("Invalid JSON body");
        }
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    "/api/observe": {
      GET(req: Request) {
        const token = extractToken(req);
        if (!token) return errorResponse("Missing Authorization header", 401);

        const result = gm.observe(token);
        if (!result) return errorResponse("Invalid token", 401);

        return jsonResponse(result);
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    "/api/act": {
      async POST(req: Request) {
        const token = extractToken(req);
        if (!token) return errorResponse("Missing Authorization header", 401);

        try {
          const body = await req.json();
          const parsed = ActRequestSchema.safeParse(body);
          if (!parsed.success) {
            return errorResponse(parsed.error.issues.map((i) => i.message).join(", "));
          }

          const result = gm.act(token, parsed.data.action);
          if (!result.ok) {
            return errorResponse(result.error ?? "Unknown error");
          }

          return jsonResponse({ ok: true });
        } catch {
          return errorResponse("Invalid JSON body");
        }
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    "/api/step": {
      async POST(req: Request) {
        const token = extractToken(req);
        if (!token) return errorResponse("Missing Authorization header", 401);

        try {
          let action: { t: string; dir?: string } | undefined;
          const contentType = req.headers.get("content-type") ?? "";
          if (contentType.includes("json")) {
            const body = await req.json();
            const parsed = StepRequestSchema.safeParse(body);
            if (parsed.success && parsed.data.action) {
              action = parsed.data.action;
            }
          }

          const result = await gm.step(token, action);
          if (!result) return errorResponse("Invalid token or game ended", 404);

          return jsonResponse(result);
        } catch {
          return errorResponse("Invalid request");
        }
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    "/api/leave": {
      async POST(req: Request) {
        const token = extractToken(req);
        if (!token) return errorResponse("Missing Authorization header", 401);

        const ok = gm.leave(token);
        return jsonResponse({ ok });
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    // ═══════════════════════════════════════
    // SSE Streaming (for bots)
    // ═══════════════════════════════════════

    "/api/stream": {
      GET(req: Request) {
        const url = new URL(req.url);
        const token = url.searchParams.get("token") ?? extractToken(req);
        if (!token) return errorResponse("Missing token", 401);

        const session = gm.sessions.getByToken(token);
        if (!session) return errorResponse("Invalid token", 401);

        let capturedController: ReadableStreamDefaultController | null = null;
        const stream = new ReadableStream({
          start(controller) {
            capturedController = controller;
            gm.registerSSEClient(session.playerId, controller);

            // Send initial state
            const obs = gm.observe(token);
            if (obs) {
              const data = `event: observe\ndata: ${JSON.stringify(obs)}\n\n`;
              controller.enqueue(new TextEncoder().encode(data));
            }
          },
          cancel() {
            if (capturedController) {
              gm.unregisterSSEClient(session.playerId, capturedController);
            }
          },
        });

        return new Response(stream, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    // ═══════════════════════════════════════
    // Public Data Endpoints
    // ═══════════════════════════════════════

    "/api/lobby": {
      GET() {
        return jsonResponse(gm.getLobbyState());
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    "/api/match/state": {
      GET() {
        const state = gm.getViewerState();
        if (!state) return jsonResponse(gm.getLobbyState());
        return jsonResponse(state);
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    "/api/leaderboard": {
      GET() {
        const rows = db.select().from(agentStats).orderBy(desc(agentStats.elo)).limit(50).all();
        const entries = rows.map(r => ({
          name: r.displayName,
          elo: r.elo,
          wins: r.wins,
          losses: r.losses,
          gamesPlayed: r.wins + r.losses,
        }));
        return jsonResponse(entries);
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },

    "/health": {
      GET() {
        return jsonResponse({
          status: "ok",
          protocol: PROTOCOL_VERSION,
          game: "gridroyale",
          phase: gm.gamePhase,
          spectators: gm.spectatorCount,
        });
      },
    },

    "/llm.txt": {
      GET() {
        return new Response(generateLlmTxt(gm), {
          headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },

    // ═══════════════════════════════════════
    // Replay Endpoints
    // ═══════════════════════════════════════

    "/api/replays": {
      GET(req: Request) {
        const url = new URL(req.url);
        const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
        const offset = parseInt(url.searchParams.get("offset") ?? "0");

        const matchRows = db
          .select()
          .from(games)
          .orderBy(desc(games.timestamp))
          .limit(limit)
          .offset(offset)
          .all();

        const matches = matchRows.map((g) => {
          const players = db
            .select()
            .from(gamePlayers)
            .where(eq(gamePlayers.gameId, g.id))
            .all();

          return {
            id: g.id,
            seed: g.seed,
            playerCount: g.playerCount,
            winnerName: g.winnerName,
            reason: g.reason,
            totalTicks: g.totalTicks,
            durationS: g.durationS,
            timestamp: g.timestamp,
            players: players.map((p) => ({
              name: p.playerName,
              placement: p.placement,
              kills: p.kills,
              eloChange: p.eloChange,
            })),
          };
        });

        return jsonResponse({ matches });
      },
      OPTIONS() {
        return new Response(null, { status: 204, headers: corsHeaders });
      },
    },
  } as Record<string, Record<string, (req: Request) => Response | Promise<Response>>>;
}

// ── Dynamic Replay Route (called from server.ts fetch handler) ──

export function handleReplayById(
  _req: Request,
  gameId: string,
  db: AppDatabase,
): Response {
  const game = db.select().from(games).where(eq(games.id, gameId)).get();
  if (!game) {
    return jsonResponse({ error: "Match not found" }, 404);
  }

  const players = db
    .select()
    .from(gamePlayers)
    .where(eq(gamePlayers.gameId, gameId))
    .all();

  const intentRows = db
    .select()
    .from(intents)
    .where(eq(intents.gameId, gameId))
    .all();

  const playerInfos = players.map((p) => ({
    id: p.playerId,
    name: p.playerName,
  }));

  const intentLog = intentRows.map((i) => ({
    tick: i.tick,
    playerId: i.playerId,
    action: i.action,
    direction: i.direction,
  }));

  const frames = replayGame(game.seed, playerInfos, intentLog, game.totalTicks);

  return jsonResponse({
    match: {
      id: game.id,
      seed: game.seed,
      playerCount: game.playerCount,
      winnerName: game.winnerName,
      reason: game.reason,
      totalTicks: game.totalTicks,
      durationS: game.durationS,
      timestamp: game.timestamp,
    },
    players: players.map((p) => ({
      id: p.playerId,
      name: p.playerName,
      placement: p.placement,
      kills: p.kills,
      eloChange: p.eloChange,
    })),
    frames,
  });
}
