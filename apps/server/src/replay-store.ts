/**
 * Replay recording and storage — SQLite backend.
 *
 * Uses Bun's built-in SQLite for persistent storage.
 * On Railway, mount a persistent volume at /data to survive redeploys.
 */
import { Database } from "bun:sqlite";
import type { AgentAction, MatchResult } from "@ai-arena/protocol";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface ReplayFrame {
  tick: number;
  actions: [AgentAction, AgentAction];
}

/** Pre-computed viewer state for a single tick */
export interface ViewerFrame {
  tick: number;
  time: number;
  robots: [ViewerRobotFrame, ViewerRobotFrame];
}

export interface ViewerRobotFrame {
  position: [number, number, number];
  rotation: [number, number, number, number];
  armAngles: [number, number];
}

export interface ReplayFile {
  version: 2;
  matchId: string;
  timestamp: string;
  result: MatchResult;
  frames: ReplayFrame[];
  viewerFrames: ViewerFrame[];
}

/** Summary metadata for the replay list (no frame data) */
export interface ReplaySummary {
  matchId: string;
  timestamp: string;
  result: MatchResult;
  frameCount: number;
}

// ── Database setup ──

const DB_PATH = process.env.DB_PATH || "./data/arena.db";

// Ensure directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.run("PRAGMA journal_mode = WAL");

// Create table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS replays (
    match_id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    winner INTEGER,
    reason TEXT NOT NULL,
    final_tick INTEGER NOT NULL,
    frame_count INTEGER NOT NULL,
    frames_json TEXT NOT NULL,
    viewer_frames_json TEXT NOT NULL
  )
`);

// Prepared statements for performance
const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO replays
    (match_id, timestamp, winner, reason, final_tick, frame_count, frames_json, viewer_frames_json)
  VALUES
    ($matchId, $timestamp, $winner, $reason, $finalTick, $frameCount, $framesJson, $viewerFramesJson)
`);

const selectOneStmt = db.prepare(`
  SELECT * FROM replays WHERE match_id = $matchId
`);

const selectSummariesStmt = db.prepare(`
  SELECT match_id, timestamp, winner, reason, final_tick, frame_count
  FROM replays
  ORDER BY timestamp DESC
`);

const selectIdsStmt = db.prepare(`
  SELECT match_id FROM replays ORDER BY timestamp DESC
`);

console.log(`[Replay] SQLite database initialized at ${DB_PATH}`);

// ── Public API ──

/**
 * Save a match replay to the database.
 */
export async function saveReplay(
  matchId: string,
  result: MatchResult,
  history: ReadonlyArray<{ tick: number; actions: [AgentAction, AgentAction] }>,
  viewerFrames: ReadonlyArray<ViewerFrame>
): Promise<string> {
  const timestamp = new Date().toISOString();

  const frames: ReplayFrame[] = history.map((h) => ({
    tick: h.tick,
    actions: h.actions,
  }));

  insertStmt.run({
    $matchId: matchId,
    $timestamp: timestamp,
    $winner: result.winner,
    $reason: result.reason,
    $finalTick: result.finalTick,
    $frameCount: viewerFrames.length,
    $framesJson: JSON.stringify(frames),
    $viewerFramesJson: JSON.stringify(viewerFrames),
  });

  console.log(
    `[Replay] Saved ${frames.length} frames + ${viewerFrames.length} viewer frames for ${matchId}`
  );
  return matchId;
}

/**
 * Load a full replay from the database.
 */
export async function loadReplay(
  matchId: string
): Promise<ReplayFile | null> {
  const row = selectOneStmt.get({ $matchId: matchId }) as {
    match_id: string;
    timestamp: string;
    winner: number | null;
    reason: string;
    final_tick: number;
    frames_json: string;
    viewer_frames_json: string;
  } | null;

  if (!row) return null;

  return {
    version: 2,
    matchId: row.match_id,
    timestamp: row.timestamp,
    result: {
      winner: row.winner as MatchResult["winner"],
      reason: row.reason as MatchResult["reason"],
      finalTick: row.final_tick,
    },
    frames: JSON.parse(row.frames_json),
    viewerFrames: JSON.parse(row.viewer_frames_json),
  };
}

/**
 * List all available replay IDs (newest first).
 */
export async function listReplays(): Promise<string[]> {
  const rows = selectIdsStmt.all() as { match_id: string }[];
  return rows.map((r) => r.match_id);
}

/**
 * List replay summaries with metadata (no frame data).
 * Sorted newest first.
 */
export async function listReplaySummaries(): Promise<ReplaySummary[]> {
  const rows = selectSummariesStmt.all() as {
    match_id: string;
    timestamp: string;
    winner: number | null;
    reason: string;
    final_tick: number;
    frame_count: number;
  }[];

  return rows.map((row) => ({
    matchId: row.match_id,
    timestamp: row.timestamp,
    result: {
      winner: row.winner as MatchResult["winner"],
      reason: row.reason as MatchResult["reason"],
      finalTick: row.final_tick,
    },
    frameCount: row.frame_count,
  }));
}

/**
 * Generate a unique match ID.
 */
export function generateMatchId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `match_${date}_${time}_${rand}`;
}
