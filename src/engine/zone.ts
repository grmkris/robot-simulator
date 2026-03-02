// ═══════════════════════════════════════════════
// Battle Royale Zone — Shrinking safe area
// ═══════════════════════════════════════════════

import {
  GRID_W,
  GRID_H,
  ZONE_SHRINK_INTERVAL,
  ZONE_DAMAGE_PER_TICK,
} from "../shared/constants.js";
import type { ZoneState, PlayerState, GameEvent } from "../shared/types.js";

/** Create the initial zone covering the full map */
export function createInitialZone(): ZoneState {
  return {
    cx: Math.floor(GRID_W / 2),
    cy: Math.floor(GRID_H / 2),
    r: Math.floor(Math.max(GRID_W, GRID_H) / 2), // covers entire map
    nextShrinkTick: ZONE_SHRINK_INTERVAL,
    phase: 0,
  };
}

/** Check if a position is inside the safe zone (Chebyshev / square zone) */
export function isInZone(x: number, y: number, zone: ZoneState): boolean {
  return Math.abs(x - zone.cx) <= zone.r && Math.abs(y - zone.cy) <= zone.r;
}

/** Process zone tick — shrink if it's time, return updated zone + events */
export function tickZone(
  zone: ZoneState,
  tick: number,
): { zone: ZoneState; events: GameEvent[] } {
  const events: GameEvent[] = [];

  if (tick >= zone.nextShrinkTick && zone.r > 0) {
    const newR = Math.max(0, zone.r - 2);
    const newZone: ZoneState = {
      cx: zone.cx,
      cy: zone.cy,
      r: newR,
      nextShrinkTick: tick + ZONE_SHRINK_INTERVAL,
      phase: zone.phase + 1,
    };
    events.push({
      tick,
      type: "ZONE_SHRINK",
      data: { newRadius: newR, phase: newZone.phase },
    });
    return { zone: newZone, events };
  }

  return { zone, events };
}

/** Apply zone damage to a player outside the zone */
export function applyZoneDamage(
  player: PlayerState,
  zone: ZoneState,
  tick: number,
): { player: PlayerState; died: boolean; event: GameEvent | null } {
  if (!player.alive || isInZone(player.x, player.y, zone)) {
    return { player, died: false, event: null };
  }

  let { shield, hp } = player;
  let remaining = ZONE_DAMAGE_PER_TICK;

  // Shield absorbs first
  if (shield > 0) {
    const absorbed = Math.min(shield, remaining);
    shield -= absorbed;
    remaining -= absorbed;
  }

  hp -= remaining;
  const died = hp <= 0;

  const updated: PlayerState = {
    ...player,
    hp: Math.max(0, hp),
    shield,
    alive: !died,
    deathTick: died ? tick : player.deathTick,
  };

  const event: GameEvent = {
    tick,
    type: "DAMAGE",
    data: {
      targetId: player.id,
      damage: ZONE_DAMAGE_PER_TICK,
      source: "zone",
    },
  };

  return { player: updated, died, event };
}
