/**
 * Replay recording and storage — file-based with persistent volume.
 *
 * Saves match replays as JSON files.
 * On Railway, set REPLAY_DIR=/data/replays to use the persistent volume.
 */
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  AgentAction,
  AgentThoughts,
  MatchResult,
} from "@ai-arena/protocol";

export interface ReplayFrame {
  tick: number;
  actions: [AgentAction, AgentAction];
}

/** Pre-computed viewer state for a single tick */
export interface ViewerFrame {
  tick: number;
  time: number;
  robots: [ViewerRobotFrame, ViewerRobotFrame];
  /** Agent thoughts at this frame (Mind Games) */
  thoughts?: { A: AgentThoughts; B: AgentThoughts };
  /** Decision round number */
  round?: number;
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
  /** Agent display names */
  agentNames?: { A: string; B: string };
}

/** Summary metadata for the replay list (no frame data) */
export interface ReplaySummary {
  matchId: string;
  timestamp: string;
  result: MatchResult;
  frameCount: number;
  agentNames?: { A: string; B: string };
}

const REPLAY_DIR = process.env.REPLAY_DIR || "./data/replays";

/**
 * Save a match replay to disk.
 */
export async function saveReplay(
  matchId: string,
  result: MatchResult,
  history: ReadonlyArray<{ tick: number; actions: [AgentAction, AgentAction] }>,
  viewerFrames: ReadonlyArray<ViewerFrame>,
  agentNames?: { A: string; B: string }
): Promise<string> {
  await mkdir(REPLAY_DIR, { recursive: true });

  const replay: ReplayFile = {
    version: 2,
    matchId,
    timestamp: new Date().toISOString(),
    result,
    frames: history.map((h) => ({
      tick: h.tick,
      actions: h.actions,
    })),
    viewerFrames: viewerFrames as ViewerFrame[],
    agentNames,
  };

  const filePath = join(REPLAY_DIR, `${matchId}.json`);
  await writeFile(filePath, JSON.stringify(replay), "utf-8");

  console.log(
    `[Replay] Saved ${replay.frames.length} frames + ${replay.viewerFrames.length} viewer frames to ${filePath}`
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
 * List replay summaries with metadata (no full frame data).
 * Sorted newest first.
 */
export async function listReplaySummaries(): Promise<ReplaySummary[]> {
  try {
    await mkdir(REPLAY_DIR, { recursive: true });
    const files = await readdir(REPLAY_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const summaries: ReplaySummary[] = [];
    for (const file of jsonFiles) {
      try {
        const content = await readFile(join(REPLAY_DIR, file), "utf-8");
        const replay = JSON.parse(content) as ReplayFile;
        summaries.push({
          matchId: replay.matchId,
          timestamp: replay.timestamp,
          result: replay.result,
          frameCount: replay.viewerFrames?.length ?? replay.frames.length,
          agentNames: replay.agentNames,
        });
      } catch {
        // skip corrupt files
      }
    }

    // Sort newest first
    summaries.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    return summaries;
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
