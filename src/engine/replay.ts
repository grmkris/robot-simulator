// ═══════════════════════════════════════════════
// Replay Engine — Reconstruct game frames from seed + intents
// ═══════════════════════════════════════════════
//
// Pure function: (seed, players, intents, totalTicks) => ViewerStateMessage[]
// Uses the same deterministic engine (tickReducer + SeededRNG).

import { createGameState, tickReducer } from "./tick-reducer.js";
import { SeededRNG } from "./rng.js";
import type { Intent, GameState } from "../shared/types.js";
import { Action, Direction } from "../shared/types.js";
import type { ViewerStateMessage, ViewerKillEvent } from "../shared/messages.js";

/** Reconstruct all viewer frames from a game's seed + intents. */
export function replayGame(
  seed: number,
  playerInfos: Array<{ id: string; name: string }>,
  intentLog: Array<{ tick: number; playerId: string; action: string; direction: string | null }>,
  totalTicks: number,
): ViewerStateMessage[] {
  // Build intent lookup: tick → Map<playerId, Intent>
  const intentsByTick = new Map<number, Map<string, Intent>>();
  for (const entry of intentLog) {
    let tickMap = intentsByTick.get(entry.tick);
    if (!tickMap) {
      tickMap = new Map();
      intentsByTick.set(entry.tick, tickMap);
    }
    tickMap.set(entry.playerId, {
      action: Action[entry.action as keyof typeof Action] ?? Action.NOOP,
      dir: entry.direction ? Direction[entry.direction as keyof typeof Direction] : undefined,
    });
  }

  const state = createGameState(seed, playerInfos);
  // Tick RNG: separate instance from same seed (matches game-manager.ts)
  const tickRng = new SeededRNG(seed);
  let currentState: GameState = state;
  const frames: ViewerStateMessage[] = [];

  // Capture frame 0 (initial state)
  frames.push(stateToFrame(currentState));

  // Run all ticks
  for (let t = 1; t <= totalTicks; t++) {
    const intents = intentsByTick.get(t) ?? new Map<string, Intent>();
    currentState = tickReducer(currentState, intents, tickRng);
    frames.push(stateToFrame(currentState));
  }

  return frames;
}

/** Convert GameState to ViewerStateMessage (mirrors getViewerState in game-manager) */
function stateToFrame(state: GameState): ViewerStateMessage {
  const players = Array.from(state.players.values()).map((p) => ({
    id: p.id,
    name: p.name,
    x: p.x,
    y: p.y,
    hp: p.hp,
    shield: p.shield,
    stamina: p.stamina,
    ammo: p.ammo,
    facing: p.facing,
    alive: p.alive,
    kills: p.kills,
  }));

  const killFeed: ViewerKillEvent[] = state.events
    .filter((e) => e.type === "KILL")
    .slice(-10)
    .map((e) => {
      const d = e.data as Record<string, unknown>;
      const victimPlayer = state.players.get(d.victimId as string);
      const killerPlayer = d.killerId ? state.players.get(d.killerId as string) : null;
      return {
        tick: e.tick,
        killerId: (d.killerId as string) ?? null,
        victimId: d.victimId as string,
        victimName: victimPlayer?.name ?? "unknown",
        killerName: killerPlayer?.name ?? null,
        weapon: (d.weapon as "projectile" | "zone") ?? "zone",
      };
    });

  return {
    type: "state" as const,
    tick: state.tick,
    phase: state.phase,
    players,
    projectiles: state.projectiles.map((p) => ({
      id: p.id,
      ownerId: p.ownerId,
      x: p.x,
      y: p.y,
      dir: p.dir,
    })),
    pickups: state.pickups.map((p) => ({
      id: p.id,
      kind: p.kind,
      x: p.x,
      y: p.y,
    })),
    zone: {
      cx: state.zone.cx,
      cy: state.zone.cy,
      r: state.zone.r,
    },
    killFeed,
    playersAlive: Array.from(state.players.values()).filter((p) => p.alive).length,
  };
}
