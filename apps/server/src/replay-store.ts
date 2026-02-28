/**
 * Replay recording and storage.
 * Saves match replays as JSON files for deterministic playback.
 */
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAction, MatchResult } from "@ai-arena/protocol";

export interface ReplayFrame {
  tick: number;
  actions: [AgentAction, AgentAction];
}

export interface ReplayFile {
  version: 1;
  matchId: string;
  timestamp: string;
  result: MatchResult;
  frames: ReplayFrame[];
}

const REPLAY_DIR = process.env.REPLAY_DIR || "./data/replays";

/**
 * Save a match replay to disk.
 */
export async function saveReplay(
  matchId: string,
  result: MatchResult,
  history: ReadonlyArray<{ tick: number; actions: [AgentAction, AgentAction] }>
): Promise<string> {
  await mkdir(REPLAY_DIR, { recursive: true });

  const replay: ReplayFile = {
    version: 1,
    matchId,
    timestamp: new Date().toISOString(),
    result,
    frames: history.map((h) => ({
      tick: h.tick,
      actions: h.actions,
    })),
  };

  const filePath = join(REPLAY_DIR, `${matchId}.json`);
  await writeFile(filePath, JSON.stringify(replay), "utf-8");

  console.log(
    `[Replay] Saved ${replay.frames.length} frames to ${filePath}`
  );
  return filePath;
}

/**
 * Load a replay file from disk.
 */
export async function loadReplay(
  matchId: string
): Promise<ReplayFile | null> {
  try {
    const filePath = join(REPLAY_DIR, `${matchId}.json`);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as ReplayFile;
  } catch {
    return null;
  }
}

/**
 * List all available replay IDs.
 */
export async function listReplays(): Promise<string[]> {
  try {
    await mkdir(REPLAY_DIR, { recursive: true });
    const files = await readdir(REPLAY_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""));
  } catch {
    return [];
  }
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
