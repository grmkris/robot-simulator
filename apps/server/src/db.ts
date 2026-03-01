/**
 * SQLite persistence layer for match history + leaderboard.
 *
 * Uses Bun's built-in SQLite driver (zero dependencies).
 * Tables are created lazily on first call to initDb().
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/arena.db";

let db: Database;

export function initDb(): void {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS matches (
      match_id   TEXT PRIMARY KEY,
      timestamp  TEXT NOT NULL,
      agent_a    TEXT NOT NULL,
      agent_b    TEXT NOT NULL,
      winner     INTEGER,
      reason     TEXT NOT NULL,
      final_tick INTEGER NOT NULL,
      duration_s REAL NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_stats (
      agent_name   TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      wins         INTEGER NOT NULL DEFAULT 0,
      losses       INTEGER NOT NULL DEFAULT 0,
      draws        INTEGER NOT NULL DEFAULT 0,
      elo          REAL NOT NULL DEFAULT 1000,
      last_seen    TEXT NOT NULL
    )
  `);

  console.log(`[DB] Initialized at ${DB_PATH}`);
}

// ── Elo helpers ──

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function updateElo(
  oldRating: number,
  expected: number,
  actual: number
): number {
  const K = 32;
  return Math.round((oldRating + K * (actual - expected)) * 10) / 10;
}

// ── Public API ──

export interface AgentStatsRow {
  agent_name: string;
  display_name: string;
  wins: number;
  losses: number;
  draws: number;
  elo: number;
  last_seen: string;
}

export interface MatchRow {
  match_id: string;
  timestamp: string;
  agent_a: string;
  agent_b: string;
  winner: number | null;
  reason: string;
  final_tick: number;
  duration_s: number;
}

/** Record a completed match and update both agents' stats + Elo. */
export function recordMatch(
  matchId: string,
  agentA: string,
  agentB: string,
  winner: 0 | 1 | null,
  reason: string,
  finalTick: number,
  durationS: number
): void {
  const now = new Date().toISOString();
  const nameA = agentA.toLowerCase();
  const nameB = agentB.toLowerCase();

  // Insert match record
  db.run(
    `INSERT OR IGNORE INTO matches (match_id, timestamp, agent_a, agent_b, winner, reason, final_tick, duration_s)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [matchId, now, agentA, agentB, winner, reason, finalTick, durationS]
  );

  // Ensure both agents exist in stats
  const upsertAgent = db.prepare(
    `INSERT INTO agent_stats (agent_name, display_name, wins, losses, draws, elo, last_seen)
     VALUES (?, ?, 0, 0, 0, 1000, ?)
     ON CONFLICT(agent_name) DO UPDATE SET display_name = excluded.display_name, last_seen = excluded.last_seen`
  );
  upsertAgent.run(nameA, agentA, now);
  upsertAgent.run(nameB, agentB, now);

  // Get current Elo ratings
  const getElo = db.prepare(
    `SELECT elo FROM agent_stats WHERE agent_name = ?`
  );
  const eloA = (getElo.get(nameA) as { elo: number })?.elo ?? 1000;
  const eloB = (getElo.get(nameB) as { elo: number })?.elo ?? 1000;

  // Calculate new Elo
  const expA = expectedScore(eloA, eloB);
  const expB = expectedScore(eloB, eloA);

  let actualA: number;
  let actualB: number;
  if (winner === 0) {
    actualA = 1;
    actualB = 0;
  } else if (winner === 1) {
    actualA = 0;
    actualB = 1;
  } else {
    actualA = 0.5;
    actualB = 0.5;
  }

  const newEloA = updateElo(eloA, expA, actualA);
  const newEloB = updateElo(eloB, expB, actualB);

  // Update stats
  if (winner === 0) {
    db.run(
      `UPDATE agent_stats SET wins = wins + 1, elo = ? WHERE agent_name = ?`,
      [newEloA, nameA]
    );
    db.run(
      `UPDATE agent_stats SET losses = losses + 1, elo = ? WHERE agent_name = ?`,
      [newEloB, nameB]
    );
  } else if (winner === 1) {
    db.run(
      `UPDATE agent_stats SET losses = losses + 1, elo = ? WHERE agent_name = ?`,
      [newEloA, nameA]
    );
    db.run(
      `UPDATE agent_stats SET wins = wins + 1, elo = ? WHERE agent_name = ?`,
      [newEloB, nameB]
    );
  } else {
    db.run(
      `UPDATE agent_stats SET draws = draws + 1, elo = ? WHERE agent_name = ?`,
      [newEloA, nameA]
    );
    db.run(
      `UPDATE agent_stats SET draws = draws + 1, elo = ? WHERE agent_name = ?`,
      [newEloB, nameB]
    );
  }

  console.log(
    `[DB] Recorded match ${matchId}: ${agentA} vs ${agentB} → ${winner === null ? "DRAW" : winner === 0 ? agentA : agentB} (${reason})`
  );
}

/** Get leaderboard sorted by Elo descending. */
export function getLeaderboard(limit = 50): AgentStatsRow[] {
  return db
    .prepare(
      `SELECT * FROM agent_stats ORDER BY elo DESC LIMIT ?`
    )
    .all(limit) as AgentStatsRow[];
}

/** Get match history, optionally filtered by agent name. */
export function getMatchHistory(
  limit = 50,
  agentName?: string
): MatchRow[] {
  if (agentName) {
    const name = agentName.toLowerCase();
    return db
      .prepare(
        `SELECT * FROM matches
         WHERE LOWER(agent_a) = ? OR LOWER(agent_b) = ?
         ORDER BY timestamp DESC LIMIT ?`
      )
      .all(name, name, limit) as MatchRow[];
  }
  return db
    .prepare(`SELECT * FROM matches ORDER BY timestamp DESC LIMIT ?`)
    .all(limit) as MatchRow[];
}

/** Get stats for a single agent. */
export function getAgentStats(name: string): AgentStatsRow | null {
  return (
    (db
      .prepare(`SELECT * FROM agent_stats WHERE agent_name = ?`)
      .get(name.toLowerCase()) as AgentStatsRow) ?? null
  );
}
