// ═══════════════════════════════════════════════
// Pickup System — Item spawning and collection
// ═══════════════════════════════════════════════

import {
  PICKUP_MEDKIT_HP,
  PICKUP_SHIELD_AMOUNT,
  PICKUP_AMMO_AMOUNT,
  PICKUP_STAMINA_AMOUNT,
  PICKUP_RESPAWN_INTERVAL,
  INITIAL_PICKUP_COUNT,
  MAX_HP,
  MAX_SHIELD,
  MAX_AMMO,
  MAX_STAMINA,
  GRID_W,
  GRID_H,
} from "../shared/constants.js";
import {
  PickupKind,
  TileType,
  type GameEvent,
  type GameState,
  type Pickup,
  type PlayerState,
} from "../shared/types.js";
import { getTile } from "./grid-map.js";
import type { SeededRNG } from "./rng.js";

const PICKUP_KINDS = [PickupKind.MEDKIT, PickupKind.SHIELD, PickupKind.AMMO, PickupKind.STAMINA];

/** Spawn the initial batch of pickups at game start */
export function spawnInitialPickups(
  state: GameState,
  rng: SeededRNG,
): { pickups: Pickup[]; nextId: number } {
  const newPickups: Pickup[] = [];
  let nextId = state.nextPickupId;

  for (let i = 0; i < INITIAL_PICKUP_COUNT; i++) {
    const pos = findEmptyTile(state, rng);
    if (!pos) continue;

    const kind = rng.pick(PICKUP_KINDS);
    newPickups.push({ id: nextId++, kind, x: pos.x, y: pos.y });
  }

  return { pickups: newPickups, nextId };
}

/** Try to spawn pickups on the map (called every tick, spawns on interval) */
export function trySpawnPickups(
  state: GameState,
  rng: SeededRNG,
  tick: number,
): { pickups: Pickup[]; nextId: number } {
  // Spawn on respawn interval ticks (skip tick 0 — initial pickups handled separately)
  if (tick === 0 || tick % PICKUP_RESPAWN_INTERVAL !== 0) {
    return { pickups: [], nextId: state.nextPickupId };
  }

  const newPickups: Pickup[] = [];
  let nextId = state.nextPickupId;

  // Spawn 2-4 pickups per interval
  const count = rng.nextIntRange(2, 4);
  for (let i = 0; i < count; i++) {
    const pos = findEmptyTile(state, rng);
    if (!pos) continue;

    const kind = rng.pick(PICKUP_KINDS);
    newPickups.push({ id: nextId++, kind, x: pos.x, y: pos.y });
  }

  return { pickups: newPickups, nextId };
}

/** Find a random empty tile that's not occupied */
function findEmptyTile(
  state: GameState,
  rng: SeededRNG,
  maxAttempts = 20,
): { x: number; y: number } | null {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const x = rng.nextInt(GRID_W);
    const y = rng.nextInt(GRID_H);

    // Must be empty tile
    if (getTile(state.map, x, y) !== TileType.EMPTY) continue;

    // Must not have a player on it
    let occupied = false;
    for (const p of state.players.values()) {
      if (p.alive && p.x === x && p.y === y) {
        occupied = true;
        break;
      }
    }
    if (occupied) continue;

    // Must not already have a pickup on it
    const hasPickup = state.pickups.some((p) => p.x === x && p.y === y);
    if (hasPickup) continue;

    return { x, y };
  }
  return null;
}

/** Apply a pickup to a player */
export function applyPickup(
  player: PlayerState,
  pickup: Pickup,
  tick: number,
): { player: PlayerState; event: GameEvent } {
  let updated = { ...player };

  switch (pickup.kind) {
    case PickupKind.MEDKIT:
      updated.hp = Math.min(MAX_HP, updated.hp + PICKUP_MEDKIT_HP);
      break;
    case PickupKind.SHIELD:
      updated.shield = Math.min(MAX_SHIELD, updated.shield + PICKUP_SHIELD_AMOUNT);
      break;
    case PickupKind.AMMO:
      updated.ammo = Math.min(MAX_AMMO, updated.ammo + PICKUP_AMMO_AMOUNT);
      break;
    case PickupKind.STAMINA:
      updated.stamina = Math.min(MAX_STAMINA, updated.stamina + PICKUP_STAMINA_AMOUNT);
      break;
  }

  const event: GameEvent = {
    tick,
    type: "PICKUP",
    data: {
      playerId: player.id,
      kind: pickup.kind,
      x: pickup.x,
      y: pickup.y,
    },
  };

  return { player: updated, event };
}
