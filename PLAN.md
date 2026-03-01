# Lobby + Leaderboard System — Implementation Plan

## Overview

Transform the single-match "first two agents get slots" system into a proper lobby with queue, countdown, match history, and leaderboard. The server remains single-instance (Railway) but can now handle sequential matches automatically.

---

## Phase 1: Database Layer (`apps/server/src/db.ts`)

**New file** — SQLite persistence using `bun:sqlite` (zero dependencies).

### Schema

```sql
-- Match history (replaces reading JSON files for summaries)
CREATE TABLE IF NOT EXISTS matches (
  match_id   TEXT PRIMARY KEY,
  timestamp  TEXT NOT NULL,
  agent_a    TEXT NOT NULL,       -- name of agent 0
  agent_b    TEXT NOT NULL,       -- name of agent 1
  winner     INTEGER,            -- 0, 1, or NULL (draw)
  reason     TEXT NOT NULL,       -- ring_out | timeout | disconnect
  final_tick INTEGER NOT NULL,
  duration_s REAL NOT NULL
);

-- Leaderboard (aggregated stats per agent name, case-insensitive)
CREATE TABLE IF NOT EXISTS agent_stats (
  agent_name TEXT PRIMARY KEY,   -- canonical lowercase name
  display_name TEXT NOT NULL,    -- last-used casing
  wins       INTEGER NOT NULL DEFAULT 0,
  losses     INTEGER NOT NULL DEFAULT 0,
  draws      INTEGER NOT NULL DEFAULT 0,
  elo        REAL NOT NULL DEFAULT 1000,
  last_seen  TEXT NOT NULL
);
```

### Module exports
- `initDb()` — create tables if not exist, path from `DB_PATH` env or `./data/arena.db`
- `recordMatch(matchId, agentA, agentB, result)` — insert into `matches`, upsert `agent_stats` for both agents (winner gets +1 win, loser +1 loss, draw gets +1 draw each), update Elo ratings
- `getLeaderboard(limit?)` — query `agent_stats` ordered by Elo desc
- `getMatchHistory(limit?, agentName?)` — query `matches` ordered by timestamp desc, optional filter by agent name
- `getAgentStats(name)` — single agent lookup

### Elo rating
Simple Elo: K=32, expected score = 1/(1+10^((Rb-Ra)/400)), update both players after each match. Draws count as 0.5.

---

## Phase 2: Queue + Countdown (`apps/server/src/match-manager.ts`)

### Agent Queue

Replace the current "assign slot directly" with a queue system:

```typescript
interface QueuedAgent {
  name: string;
  token: string;
  joinedAt: number;  // Date.now()
}

private queue: QueuedAgent[] = [];
```

**New join flow:**
1. `POST /api/join` → agent is added to `queue` (not directly assigned a slot)
2. Response includes `{ token, position: queue.indexOf(agent) + 1 }`
3. Agent polls `GET /api/game-state` with token:
   - If still in queue → `{ status: "queued", position: N, queueSize: M }`
   - If matched → existing flow (waiting/countdown/active/finished)
4. After each match ends, server auto-pops next 2 agents from queue and starts countdown

**Queue rules:**
- Max queue size: 10 agents
- Inactivity timeout: 60s without polling → removed from queue
- Agent can `POST /api/leave` while queued → removed

### Countdown Phase

After 2 agents are popped from queue and assigned to slots:

1. `Simulation.init()` runs (robots spawn)
2. Match phase = `"countdown"` for 5 seconds (300 ticks)
3. During countdown: physics runs but actions are ignored (robots stand still)
4. After countdown: phase transitions to `"active"`
5. Viewer receives countdown state via WS broadcast

Implementation: Add `COUNTDOWN_DURATION_S = 5` to `constants.ts`. In `Simulation`, track `countdownTicks` and skip action application until countdown expires.

### Post-match flow

After a match ends:
1. Record result in DB via `recordMatch()`
2. Save replay as before
3. After 10-second result window, auto-pop next 2 from queue
4. Agents that just finished are NOT auto-requeued (they must POST /join again if they want to play again)

---

## Phase 3: New API Endpoints (`apps/server/src/main.ts`)

Add these routes:

```
GET  /api/leaderboard          → { leaderboard: AgentStats[] }
GET  /api/match-history        → { matches: MatchRecord[] }
GET  /api/match-history/:agent → { matches: MatchRecord[] } (filtered)
GET  /api/lobby                → { queue: QueueEntry[], currentMatch: MatchInfo | null }
```

### Lobby state (broadcast to spectator WS too)

The spectator WebSocket will receive a new message type:

```typescript
interface LobbyStateMessage {
  type: "lobby";
  queue: Array<{ name: string; position: number }>;
  currentMatch: {
    agentA: string;
    agentB: string;
    phase: MatchPhase;
    tick: number;
    time: number;
  } | null;
}
```

This is broadcast:
- When queue changes (agent joins/leaves/matched)
- Every 5 seconds as a heartbeat during waiting phase
- Alongside `match_end` messages

---

## Phase 4: Protocol Changes (`packages/protocol/`)

### New constants (`constants.ts`)
```typescript
export const COUNTDOWN_DURATION_S = 5;
export const COUNTDOWN_DURATION_TICKS = COUNTDOWN_DURATION_S * TICK_RATE;
export const MAX_QUEUE_SIZE = 10;
export const QUEUE_INACTIVITY_TIMEOUT_MS = 60_000;
```

### Updated types (`types.ts`)

Add to `GameStateResponse`:
```typescript
// New status value
status: "waiting" | "queued" | "countdown" | "active" | "finished";
// Queue info (when status = "queued")
position?: number;
queueSize?: number;
```

Add new exported types:
```typescript
export interface LeaderboardEntry {
  agentName: string;
  displayName: string;
  wins: number;
  losses: number;
  draws: number;
  elo: number;
  matches: number;
  winRate: number;
}

export interface MatchHistoryEntry {
  matchId: string;
  timestamp: string;
  agentA: string;
  agentB: string;
  winner: AgentId | null;
  reason: string;
  durationS: number;
}
```

---

## Phase 5: Viewer UI (`apps/viewer/`)

### Layout change

The main page (`/`) gets a **sidebar layout** when not in active match. During active matches, the 3D arena is fullscreen as before. During waiting/queue, show a lobby view.

### New/Updated Components

**`LobbyView.tsx`** — shown when `matchPhase === "waiting" || "disconnected"`:
- Top section: Animated title "AI ACTUATOR ARENA"
- Queue panel: list of queued agents with position numbers
- Mini leaderboard: top 10 agents by Elo
- Recent matches: last 5 match results with links to replays
- "Next match" preview when 2+ agents are queued

**`Leaderboard.tsx`** — reusable leaderboard table:
- Columns: Rank, Name, Elo, W/L/D, Win%, Matches
- Color coding: gold/silver/bronze for top 3
- Click agent name to see their match history

**`MatchHistory.tsx`** — reusable match list (used in both lobby and /replays page):
- Shows matchups, results, duration, timestamps
- Links to replay viewer

**Updated `MatchHUD.tsx`**:
- Show countdown timer (big "3... 2... 1... FIGHT!" overlay)
- Show queue size indicator during active match ("3 in queue")

### New pages

**`/leaderboard`** — full leaderboard page with all agents, sortable columns
**Update `/replays`** — integrate with DB-backed match history instead of raw file listing

### Store changes (`lib/store.ts`)

Add to `ArenaStore`:
```typescript
// Lobby state
queue: Array<{ name: string; position: number }>;
leaderboard: LeaderboardEntry[];
recentMatches: MatchHistoryEntry[];

// New WS message handler
updateLobby: (msg: LobbyStateMessage) => void;
```

### Data fetching

- Leaderboard + match history: fetched via REST on page load, refreshed after each match ends
- Queue state: pushed via WS `lobby` message type (real-time)

---

## Phase 6: Viewer API Proxy Routes (`apps/viewer/src/app/api/`)

Add proxy routes (Next.js API routes that forward to the game server, avoiding CORS):

```
GET /api/leaderboard    → proxy to server /api/leaderboard
GET /api/match-history  → proxy to server /api/match-history
GET /api/lobby          → proxy to server /api/lobby
```

(Pattern already exists: `/api/config` and `/api/replays` are proxied this way.)

---

## File Change Summary

### New files
| File | Purpose |
|------|---------|
| `apps/server/src/db.ts` | SQLite database layer |
| `apps/viewer/src/components/LobbyView.tsx` | Lobby waiting screen with queue + leaderboard |
| `apps/viewer/src/components/Leaderboard.tsx` | Leaderboard table component |
| `apps/viewer/src/app/leaderboard/page.tsx` | Full leaderboard page |
| `apps/viewer/src/app/api/leaderboard/route.ts` | Proxy to server |
| `apps/viewer/src/app/api/match-history/route.ts` | Proxy to server |
| `apps/viewer/src/app/api/lobby/route.ts` | Proxy to server |

### Modified files
| File | Changes |
|------|---------|
| `packages/protocol/src/constants.ts` | Add countdown + queue constants |
| `packages/protocol/src/types.ts` | Add `"queued"` status, LeaderboardEntry, MatchHistoryEntry types |
| `packages/protocol/src/schemas.ts` | (minor, if needed for new response validation) |
| `apps/server/src/main.ts` | Add leaderboard/history/lobby routes, init DB |
| `apps/server/src/match-manager.ts` | Queue system, countdown, DB recording, lobby broadcasts |
| `apps/server/src/http-agent-handler.ts` | Update join response (queue position), handle "queued" status |
| `apps/viewer/src/lib/store.ts` | Add queue/leaderboard/recentMatches state |
| `apps/viewer/src/lib/types.ts` | Add LobbyStateMessage type |
| `apps/viewer/src/hooks/useMatchSocket.ts` | Handle "lobby" WS message type |
| `apps/viewer/src/app/page.tsx` | Conditional render: LobbyView vs Arena3D |
| `apps/viewer/src/components/MatchHUD.tsx` | Countdown overlay, queue indicator |
| `apps/viewer/src/app/replays/page.tsx` | Use DB-backed match history |

---

## Implementation Order

1. **Phase 1** — Database layer (standalone, no breaking changes)
2. **Phase 4** — Protocol types + constants (foundation for everything)
3. **Phase 2** — Queue + countdown in MatchManager (backward-compatible: single agent joining still works)
4. **Phase 3** — New API endpoints
5. **Phase 6** — Viewer proxy routes (trivial, follows existing pattern)
6. **Phase 5** — Viewer UI (can start once API exists)

Each phase is independently deployable. The old `POST /api/join` → immediate match flow still works when exactly 2 agents join (they just go through the queue instantly).
