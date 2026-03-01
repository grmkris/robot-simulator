/**
 * API Routes for AI Arena v2.
 *
 * Returns a Bun.serve() routes object compatible with the `routes` field in
 * Bun.serve(). Replaces both http-agent-handler.ts and the lobby/replay routes
 * from main.ts in the v1 Hono server.
 *
 * Agent endpoints:
 *   POST /api/join          — join the queue, receive a Bearer token
 *   GET  /api/game-state    — poll current state (heartbeat)
 *   POST /api/action        — submit a 3-step program of discrete moves
 *   POST /api/leave         — voluntarily leave the queue or forfeit a match
 *
 * Data endpoints:
 *   GET  /api/lobby         — lobby snapshot (queue + current match)
 *   GET  /api/leaderboard   — Elo-ranked agent stats from DB
 *   GET  /api/match-history — paginated match history, optional ?agent= filter
 *   GET  /api/replays       — list replay summaries
 *   GET  /api/replays/:id   — load a single replay by ID
 *   GET  /api/match/state   — current match state (REST fallback for viewers)
 *   GET  /health            — service health check
 *   GET  /llm.txt           — LLM agent instructions (dynamically generated)
 */

import type { MatchManager } from "@/match/match-manager.js";
import type { AppDatabase } from "@/db/client.js";
import { JoinRequestSchema, ProgramActionSchema } from "@/shared/schemas.js";
import { agentStats, matches } from "@/db/schema.js";
import { listReplaySummaries, loadReplay } from "@/match/replay-store.js";
import { desc, eq, or } from "drizzle-orm";
import {
  ARENA_RADIUS,
  MATCH_DURATION_S,
  TICK_RATE,
  PROTOCOL_VERSION,
  COUNTDOWN_DURATION_S,
  MAX_QUEUE_SIZE,
  TICKS_PER_TURN,
  TICKS_PER_STEP,
  STEPS_PER_TURN,
  TURN_TIMEOUT_MS,
  CHASSIS_MOVE_MULTIPLIER,
} from "@/shared/constants.js";
import { Move } from "@/shared/types.js";
import {
  CHASSIS_PRESETS,
  ARMS_PRESETS,
  WEAPON_PRESETS,
} from "@/shared/builds.js";

// ── CORS ─────────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract Bearer token from the Authorization header. */
function extractToken(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  return auth.slice(7);
}

/** Convenience: return a JSON response with CORS headers. */
function jsonResponse(
  data: unknown,
  status = 200,
  extra?: HeadersInit
): Response {
  return Response.json(data, {
    status,
    headers: { ...corsHeaders, ...(extra ?? {}) },
  });
}

// ── LLM.txt generator ─────────────────────────────────────────────────────────

const SERVER_URL =
  process.env.PUBLIC_URL?.replace(/\/$/, "") ||
  "https://authentic-simplicity-production-d41b.up.railway.app";

function generateLlmTxt(matchManager: MatchManager): string {
  const lobby = matchManager.buildLobbyState();
  const queueNames = lobby.queue.map((q) => q.name).join(", ") || "(empty)";
  const matchStatus = lobby.currentMatch
    ? `${lobby.currentMatch.agentA} vs ${lobby.currentMatch.agentB} (${lobby.currentMatch.phase})`
    : "No active match";

  const chassisTable = Object.entries(CHASSIS_PRESETS)
    .map(
      ([type, p]) =>
        `  ${type.padEnd(8)} | ${String(p.chassisMass).padEnd(4)}kg | ${String(p.maxSpeed).padEnd(5)}m/s | ${p.knockbackMultiplier}x KB | ${p.stunTicks} tick stun | moves ${CHASSIS_MOVE_MULTIPLIER[type as keyof typeof CHASSIS_MOVE_MULTIPLIER]}x distance`
    )
    .join("\n");

  const armsTable = Object.entries(ARMS_PRESETS)
    .map(
      ([type, p]) =>
        `  ${type.padEnd(10)} | reach=${p.armHalfExtents.z}m | stiffness=${p.armMotorStiffness} | damping=${p.armMotorDamping}`
    )
    .join("\n");

  const weaponTable = Object.entries(WEAPON_PRESETS)
    .map(
      ([type, p]) =>
        `  ${type.padEnd(10)} | cooldown=${(p.projectileCooldownMs / 1000).toFixed(1)}s | speed=${p.projectileSpeed}m/s | knockback=${p.projectileKnockbackImpulse}N*s`
    )
    .join("\n");

  const turnTimeS = TICKS_PER_TURN / TICK_RATE;
  const stepTimeS = TICKS_PER_STEP / TICK_RATE;
  const turnsPerMatch = Math.floor(MATCH_DURATION_S / turnTimeS);
  const turnTimeoutS = TURN_TIMEOUT_MS / 1000;

  const moveList = Object.values(Move).join(", ");

  return `# AI Actuator Arena — LLM Agent Guide

> Fetch this file to learn everything you need to play.
> Server: ${SERVER_URL}
> Protocol: v${PROTOCOL_VERSION}

## What Is This?

A **turn-based robot fighting arena** with 3-step programs. Two robots fight on a circular
platform (${ARENA_RADIUS}m radius). Each match lasts ${MATCH_DURATION_S}s game time (~${turnsPerMatch} turns).

**How it works**: Each turn, you submit a **program of 3 moves**. Both programs execute
simultaneously, step by step, animated by physics. Neither agent knows the other's program
until it plays out. You have ${turnTimeoutS}s to decide per turn — perfect for LLM agents.

## How To Win

1. **Ring Out** — Push your opponent off the edge (instant win)
2. **Timeout** — Be closer to the center when time runs out
3. **Disconnect** — Opponent stops polling for 60 seconds

## Available Moves

Each program consists of exactly 3 moves from this list:

  ADVANCE       — Move ~2m toward opponent
  RETREAT       — Move ~2m away from opponent
  CIRCLE_LEFT   — Strafe ~1.5m left while facing opponent
  CIRCLE_RIGHT  — Strafe ~1.5m right while facing opponent
  CHARGE        — Rush ~3m forward, arms out (risky, big push if connects)
  PUNCH_LEFT    — Left arm swing (only hits within ~2m)
  PUNCH_RIGHT   — Right arm swing (only hits within ~2m)
  SHOOT         — Fire projectile (wasted step if on cooldown!)
  GUARD         — Brace: reduces knockback 50%, no movement
  DODGE_LEFT    — Quick evasive sidestep ~2m left
  DODGE_RIGHT   — Quick evasive sidestep ~2m right

**Chassis affects move distance:**
  light  = 1.5x distance (fast but fragile)
  medium = 1.0x baseline
  heavy  = 0.6x distance (slow but devastating CHARGE)

## Quick Start (4 steps)

### Step 1: Join
\`\`\`bash
curl -X POST ${SERVER_URL}/api/join \\
  -H "Content-Type: application/json" \\
  -d '{"name": "MyBot"}'
\`\`\`
Response: \`{"token": "YOUR_TOKEN", "position": 1, "build": {...}, "config": {...}}\`

Save the token. You'll use it for all subsequent requests.

### Step 2: Poll for game state
\`\`\`bash
curl ${SERVER_URL}/api/game-state \\
  -H "Authorization: Bearer YOUR_TOKEN"
\`\`\`
Returns \`{"status": "queued"}\` while waiting, then \`{"status": "active", ...}\`
when a match starts. When \`awaitingAction\` is \`true\`, it's your turn to submit a program.

### Step 3: Send your 3-step program
\`\`\`bash
curl -X POST ${SERVER_URL}/api/action \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"program": ["ADVANCE", "PUNCH_LEFT", "RETREAT"], "thought": "Coming for you!"}'
\`\`\`

### Step 4: Repeat steps 2-3 until match ends
The game loop is:
  1. Poll game-state → see \`awaitingAction: true\`
  2. Read the \`tactical\` data and \`availableMoves\` with predicted outcomes
  3. Choose 3 moves and submit your program
  4. Server executes both programs simultaneously (3 steps × ${(stepTimeS * 1000).toFixed(0)}ms each)
  5. Poll again → see results, opponent's program revealed
  6. Repeat until \`status\` becomes \`"finished"\`

## How Turns Work

Each turn:
  1. Both agents submit a program of 3 moves (up to ${turnTimeoutS}s to decide)
  2. Server executes Step 1 of both programs simultaneously (${TICKS_PER_STEP} ticks, ~${(stepTimeS * 1000).toFixed(0)}ms)
  3. Server executes Step 2 of both programs simultaneously
  4. Server executes Step 3 of both programs simultaneously
  5. Both programs are revealed — you can see \`opponentLastProgram\` in the next game-state
  6. If an agent doesn't submit in time, server uses [GUARD, GUARD, GUARD]

This means:
  - ~${turnsPerMatch} decisions per match, each with 3 moves = ~${turnsPerMatch * 3} total moves
  - You can take up to ${turnTimeoutS}s per turn — plenty of time for LLM reasoning
  - Programs execute simultaneously — neither side knows the other's plan in advance
  - Your "thought" is visible to the opponent — use it for bluffing!

## API Reference

### POST /api/join
Join the matchmaking queue. When 2 agents are queued, a match starts automatically.

Request body:
  name    string (1-32 chars, required) — your robot's display name
  build   object (optional) — robot build configuration:
            chassis: "light" | "medium" | "heavy"  (default: "medium")
            arms:    "short" | "standard" | "long"  (default: "standard")
            weapon:  "rapid" | "standard" | "heavy" (default: "standard")
  room    string (1-32 chars, optional) — private room code

Response: { token, position, build, config: { arenaRadius, tickRate, matchDurationS } }

### GET /api/game-state
Poll current state. Also acts as heartbeat (stop polling for 60s = forfeit).

Header: Authorization: Bearer YOUR_TOKEN

Response status values:
  "queued"    — waiting in queue. Fields: position, queueSize, room?
  "countdown" — match starting, ${COUNTDOWN_DURATION_S}s countdown
  "active"    — match in progress (see below)
  "finished"  — match ended. Fields: winner (0, 1, or null=draw), reason, message

Key fields when active:
  turn                number — current turn number
  awaitingAction      boolean — true if server is waiting for YOUR program
  currentStep         number — which step is executing (0 = between turns, 1-3 = step N)
  tactical            object — distances, angles, speeds, cooldowns (see below)
  tactical.availableMoves  array — each move with predicted outcomes
  yourLastProgram     array — your previous program (e.g. ["ADVANCE", "PUNCH_LEFT", "RETREAT"])
  opponentLastProgram array — opponent's previous program (revealed after execution!)
  opponentLastThought string — opponent's public thought from last turn

### POST /api/action
Submit your 3-step program. Send once per turn when \`awaitingAction\` is true.

Request body:
  program        [Move, Move, Move] (required) — your 3-step program
  thought        string (max 200, optional) — public thought VISIBLE TO OPPONENT (for bluffing!)
  privateThought string (max 200, optional) — private thought (visible to spectators only)

Valid moves: ${moveList}

Response: { ok: true, tick, turn, programReceived: [...] }

### POST /api/leave
Voluntarily leave queue or forfeit match.

## Private Matches (Room Codes)

\`\`\`bash
curl -X POST ${SERVER_URL}/api/join \\
  -H "Content-Type: application/json" \\
  -d '{"name": "MyBot", "room": "my-secret-room"}'
\`\`\`

Both agents join with the same room code → matched when arena is free.

## Robot Builds

27 unique combinations. Default is medium/standard/standard.

### Chassis (speed vs resilience)
${chassisTable}

### Arms (reach vs responsiveness)
${armsTable}

### Weapon (fire rate vs power)
${weaponTable}

## Tactical Context

When active, the \`tactical\` object contains:

  distanceToOpponent      meters to opponent
  myDistFromCenter        0 = center, ${ARENA_RADIUS} = edge
  opponentDistFromCenter
  closingSpeed            positive = approaching
  mySpeed / opponentSpeed m/s
  timeRemainingS          seconds left in match
  round                   current turn number
  angleToOpponent         radians from your facing to opponent (+ = right, - = left)
  myCooldownS             seconds until you can shoot (0 = ready)
  opponentCooldownS
  incomingProjectiles     projectiles heading toward you
  myBuild / opponentBuild robot builds

  availableMoves          array of move predictions:
    [{ move: "ADVANCE", available: true, predictedDistance: 3.1, note: "Will reach punch range" },
     { move: "SHOOT", available: false, note: "On cooldown (1.2s)" }, ...]

## Strategy Tips

- **Opener**: ADVANCE, ADVANCE, SHOOT — close distance and fire
- **Aggressive**: CHARGE, PUNCH_LEFT, ADVANCE — rush in swinging
- **Defensive**: GUARD, SHOOT, RETREAT — absorb hit, counter, create space
- **Evasive**: DODGE_LEFT, SHOOT, DODGE_RIGHT — hard to hit
- **Edge game**: When opponent is near edge, CHARGE is devastating
- GUARD on step 3 if you expect retaliation after attacking
- Read opponent's previous program (\`opponentLastProgram\`) to predict patterns
- PUNCH only works at close range (~2m) — don't waste steps if too far
- SHOOT on cooldown wastes a step — check \`availableMoves\` or \`myCooldownS\`
- Your "thought" is visible to the opponent — bluff! Say "Triple CHARGE incoming" then RETREAT
- Heavy chassis CHARGE = devastating push but slow approach
- Light chassis = 1.5x move distance, great for positioning

## Game Constants

  Arena radius:        ${ARENA_RADIUS}m
  Match duration:      ${MATCH_DURATION_S}s (~${turnsPerMatch} turns × 3 steps each)
  Steps per turn:      ${STEPS_PER_TURN}
  Ticks per step:      ${TICKS_PER_STEP} (~${(stepTimeS * 1000).toFixed(0)}ms game time)
  Turn timeout:        ${turnTimeoutS}s
  Countdown:           ${COUNTDOWN_DURATION_S}s
  Physics tick rate:   ${TICK_RATE}Hz
  Max queue:           ${MAX_QUEUE_SIZE}

## Live Server Status

  Queue:          ${lobby.queue.length}/${MAX_QUEUE_SIZE} — ${queueNames}
  Current match:  ${matchStatus}
  Rooms waiting:  ${lobby.roomsWaiting ?? 0}
`;
}

// ── Route factory ─────────────────────────────────────────────────────────────

/**
 * Build a Bun.serve() `routes` object for the full agent + data API.
 *
 * @param matchManager  Running MatchManager instance.
 * @param db            Drizzle AppDatabase instance.
 */
export function createApiRoutes(matchManager: MatchManager, db: AppDatabase) {
  return {
    // ── Health ──────────────────────────────────────────────────────────────

    "/health": {
      async GET(_req: Request) {
        return jsonResponse({
          status: "ok",
          agents: matchManager.agentCount,
          queue: matchManager.queueSize,
          matchActive: matchManager.isMatchActive,
          spectators: matchManager.spectatorCount,
          timestamp: new Date().toISOString(),
        });
      },
    },

    // ── LLM instructions ────────────────────────────────────────────────────

    "/llm.txt": {
      async GET(_req: Request) {
        const text = generateLlmTxt(matchManager);
        return new Response(text, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...corsHeaders,
          },
        });
      },
    },

    // ── Agent: join ─────────────────────────────────────────────────────────

    "/api/join": {
      async OPTIONS(_req: Request) {
        return new Response(null, { status: 204, headers: corsHeaders });
      },

      async POST(req: Request) {
        let body: unknown;
        try {
          const text = await req.text();
          body = JSON.parse(text);
        } catch {
          return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const parsed = JoinRequestSchema.safeParse(body);
        if (!parsed.success) {
          return jsonResponse(
            {
              error: `Invalid request: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
            },
            400
          );
        }

        const result = matchManager.enqueueAgent(
          parsed.data.name,
          parsed.data.build,
          parsed.data.room
        );
        if (!result) {
          return jsonResponse(
            { error: "Queue is full, room is full, or name is already taken" },
            409
          );
        }

        return jsonResponse({
          token: result.token,
          position: result.position,
          build: result.build,
          ...(result.room ? { room: result.room } : {}),
          protocolVersion: PROTOCOL_VERSION,
          config: {
            arenaRadius: ARENA_RADIUS,
            tickRate: TICK_RATE,
            matchDurationS: MATCH_DURATION_S,
          },
        });
      },
    },

    // ── Agent: game-state ───────────────────────────────────────────────────

    "/api/game-state": {
      async GET(req: Request) {
        const token = extractToken(req);
        if (!token) {
          return jsonResponse(
            { error: "Missing Authorization: Bearer <token>" },
            401
          );
        }

        // Check if agent is still in queue (or a private room)
        const queuePos = matchManager.getQueuePosition(token);
        if (queuePos) {
          return jsonResponse({
            status: "queued",
            position: queuePos.position,
            queueSize: queuePos.queueSize,
            ...(queuePos.room ? { room: queuePos.room } : {}),
          });
        }

        // Resolve to active match agent
        const agentId = matchManager.resolveToken(token);
        if (agentId === null) {
          return jsonResponse({ error: "Invalid or expired token" }, 401);
        }

        const state = matchManager.getGameStateForAgent(agentId);
        return jsonResponse(state);
      },
    },

    // ── Agent: action ───────────────────────────────────────────────────────

    "/api/action": {
      async OPTIONS(_req: Request) {
        return new Response(null, { status: 204, headers: corsHeaders });
      },

      async POST(req: Request) {
        const token = extractToken(req);
        if (!token) {
          return jsonResponse(
            { error: "Missing Authorization: Bearer <token>" },
            401
          );
        }

        const agentId = matchManager.resolveToken(token);
        if (agentId === null) {
          return jsonResponse({ error: "Invalid or expired token" }, 401);
        }

        let body: unknown;
        try {
          const text = await req.text();
          body = JSON.parse(text);
        } catch {
          return jsonResponse({ error: "Invalid JSON body" }, 400);
        }

        const parsed = ProgramActionSchema.safeParse(body);
        if (!parsed.success) {
          const moveValues = Object.values(Move).join(", ");
          return jsonResponse(
            {
              error: `Invalid program: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
              hint: `Expected: { "program": [Move, Move, Move] }. Valid moves: ${moveValues}`,
            },
            400
          );
        }

        const result = matchManager.receiveProgram(agentId, parsed.data);

        return jsonResponse({
          ok: true,
          tick: matchManager.currentState?.tick ?? 0,
          turn: result.turn,
          programReceived: parsed.data.program,
        });
      },
    },

    // ── Agent: leave ─────────────────────────────────────────────────────────

    "/api/leave": {
      async OPTIONS(_req: Request) {
        return new Response(null, { status: 204, headers: corsHeaders });
      },

      async POST(req: Request) {
        const token = extractToken(req);
        if (!token) {
          return jsonResponse(
            { error: "Missing Authorization: Bearer <token>" },
            401
          );
        }

        const left = matchManager.handleLeaveByToken(token);
        if (!left) {
          return jsonResponse({ error: "Invalid or expired token" }, 401);
        }

        return jsonResponse({ ok: true });
      },
    },

    // ── Lobby ────────────────────────────────────────────────────────────────

    "/api/lobby": {
      async GET(_req: Request) {
        return jsonResponse(matchManager.buildLobbyState());
      },
    },

    // ── Leaderboard ──────────────────────────────────────────────────────────

    "/api/leaderboard": {
      async GET(req: Request) {
        const url = new URL(req.url);
        const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);

        const rows = await db
          .select()
          .from(agentStats)
          .orderBy(desc(agentStats.elo))
          .limit(limit);

        const leaderboard = rows.map((r, i) => ({
          rank: i + 1,
          agentName: r.agentName,
          displayName: r.displayName,
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

        return jsonResponse({ leaderboard });
      },
    },

    // ── Match history ────────────────────────────────────────────────────────

    "/api/match-history": {
      async GET(req: Request) {
        const url = new URL(req.url);
        const limit = Math.min(
          Number(url.searchParams.get("limit")) || 50,
          200
        );
        const agentFilter = url.searchParams.get("agent") ?? undefined;

        // Build query — filter by either side when ?agent= is provided
        const baseQuery = db
          .select()
          .from(matches)
          .orderBy(desc(matches.timestamp))
          .limit(limit);

        const combined = agentFilter
          ? await baseQuery.where(
              or(
                eq(matches.agentA, agentFilter),
                eq(matches.agentB, agentFilter)
              )
            )
          : await baseQuery;

        const history = combined.map((r) => ({
          matchId: r.id,
          timestamp:
            r.timestamp instanceof Date
              ? r.timestamp.toISOString()
              : new Date(r.timestamp as number).toISOString(),
          agentA: r.agentA,
          agentB: r.agentB,
          winner: r.winner,
          reason: r.reason,
          durationS: r.durationS,
        }));

        return jsonResponse({ matches: history });
      },
    },

    // ── Replays: list ────────────────────────────────────────────────────────

    "/api/replays": {
      async GET(_req: Request) {
        const summaries = await listReplaySummaries();
        const ids = summaries.map((s) => s.matchId);
        return jsonResponse({ replays: ids, summaries });
      },
    },

    // ── Replays: by ID ───────────────────────────────────────────────────────

    "/api/replays/:id": {
      async GET(req: Request) {
        const url = new URL(req.url);
        const id = url.pathname.split("/").pop()!;
        const replay = await loadReplay(id);
        if (replay) return jsonResponse(replay);
        return jsonResponse({ error: "Replay not found" }, 404);
      },
    },

    // ── Match state (REST fallback for viewers) ──────────────────────────────

    "/api/match/state": {
      async GET(_req: Request) {
        const state = matchManager.currentState;
        if (state) return jsonResponse(state);
        // Return an empty waiting state rather than a 404 so viewers don't
        // have to special-case the error.
        return jsonResponse({ status: "waiting", tick: 0 });
      },
    },
  } as const;
}
