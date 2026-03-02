// ═══════════════════════════════════════════════
// Tick Reducer — Pure deterministic game engine
// ═══════════════════════════════════════════════
//
// Core pure function: (state, intents, rng) => nextState
// No side effects, no I/O, no mutation.
// Same seed + same intents = identical output.

import {
  DASH_COOLDOWN,
  DASH_DISTANCE,
  DASH_STAMINA_COST,
  DECISION_INTERVAL,
  INITIAL_AMMO,
  INITIAL_HP,
  INITIAL_SHIELD,
  INITIAL_STAMINA,
  MAX_STAMINA,
  PICKUP_COOLDOWN,
  SHOOT_COOLDOWN,
  STAMINA_REGEN_PER_TICK,
} from "../shared/constants.js";
import {
  Action,
  DIRECTION_DELTAS,
  type ActionResult,
  type GameEvent,
  type GameResult,
  type GameState,
  type Intent,
  type Placement,
  type PlayerState,
} from "../shared/types.js";
import { isPassable, isInBounds } from "./grid-map.js";
import { spawnProjectile, tickProjectiles } from "./projectiles.js";
import { applyPickup, trySpawnPickups, spawnInitialPickups } from "./pickups.js";
import { tickZone, applyZoneDamage } from "./zone.js";
import { createInitialZone } from "./zone.js";
import { createMap } from "./grid-map.js";
import { generateSpawnPositions } from "./spawner.js";
import { SeededRNG } from "./rng.js";

// ── Game Initialization ──

/** Create a new game state with players positioned on the map */
export function createGameState(
  seed: number,
  playerInfos: Array<{ id: string; name: string }>,
): GameState {
  const rng = new SeededRNG(seed);
  const map = createMap(rng);
  const zone = createInitialZone();
  const spawns = generateSpawnPositions(playerInfos.length, map, rng);

  const players = new Map<string, PlayerState>();
  for (let i = 0; i < playerInfos.length; i++) {
    const info = playerInfos[i]!;
    const spawn = spawns[i]!;
    players.set(info.id, {
      id: info.id,
      name: info.name,
      x: spawn.pos.x,
      y: spawn.pos.y,
      hp: INITIAL_HP,
      shield: INITIAL_SHIELD,
      stamina: INITIAL_STAMINA,
      ammo: INITIAL_AMMO,
      facing: spawn.facing,
      cooldowns: { shoot: 0, dash: 0, pickup: 0 },
      alive: true,
      kills: 0,
      deathTick: null,
    });
  }

  const initialState: GameState = {
    tick: 0,
    seed,
    map,
    players,
    projectiles: [],
    pickups: [],
    zone,
    phase: "active",
    events: [],
    nextProjectileId: 1,
    nextPickupId: 1,
    actionResults: new Map(),
  };

  // Spawn initial pickups on the map
  const initialPickups = spawnInitialPickups(initialState, rng);
  initialState.pickups = initialPickups.pickups;
  initialState.nextPickupId = initialPickups.nextId;

  return initialState;
}

// ── Tick Reducer ──

/**
 * Advance the game state by one simulation tick.
 * This is a pure function — no mutation of input state.
 *
 * Processing order:
 * 1. Validate intents
 * 2. Resolve MOVE/DASH (collision check)
 * 3. Process SHOOT (spawn projectile)
 * 4. Advance existing projectiles + hit detection
 * 5. Process PICKUP
 * 6. Zone tick (shrink + damage)
 * 7. Cooldown decrement
 * 8. Stamina regen
 * 9. Spawn pickups
 * 10. Check win condition
 */
export function tickReducer(
  state: GameState,
  intents: Map<string, Intent>,
  rng: SeededRNG,
): GameState {
  if (state.phase !== "active") return state;

  const tick = state.tick + 1;
  const events: GameEvent[] = [];

  // Clone players map
  const players = new Map<string, PlayerState>();
  for (const [id, p] of state.players) {
    players.set(id, { ...p, cooldowns: { ...p.cooldowns } });
  }

  let projectiles = [...state.projectiles];
  let pickups = [...state.pickups];
  let nextProjectileId = state.nextProjectileId;
  let nextPickupId = state.nextPickupId;

  // Only process intents on decision ticks
  const isDecisionTick = tick % DECISION_INTERVAL === 0;
  const actionResults = new Map<string, ActionResult>();

  if (isDecisionTick) {
    // ── 1. Validate intents (record rejection reasons) ──
    const validIntents = new Map<string, Intent>();
    for (const [playerId, intent] of intents) {
      const player = players.get(playerId);
      if (!player || !player.alive) continue;
      const { validated, rejectionReason } = validateIntentWithReason(intent, player, state);
      validIntents.set(playerId, validated);

      // If intent was rejected (downgraded to NOOP), record the reason
      if (rejectionReason) {
        actionResults.set(playerId, {
          action: intent.action,
          dir: intent.dir,
          success: false,
          reason: rejectionReason,
        });
      }
    }

    // Players who didn't submit get NOOP
    for (const [id, player] of players) {
      if (player.alive && !validIntents.has(id)) {
        validIntents.set(id, { action: Action.NOOP });
      }
    }

    // ── 2. Resolve MOVE and DASH ──
    const moveTargets = new Map<string, { x: number; y: number }>();
    // Track which MOVEs were blocked by walls/bounds (before collision resolution)
    const moveBlockedByWall = new Set<string>();

    for (const [id, intent] of validIntents) {
      const player = players.get(id)!;

      if (intent.action === Action.MOVE && intent.dir) {
        const delta = DIRECTION_DELTAS[intent.dir];
        const nx = player.x + delta.x;
        const ny = player.y + delta.y;

        if (!isInBounds(nx, ny)) {
          moveBlockedByWall.add(id);
          actionResults.set(id, { action: Action.MOVE, dir: intent.dir, success: false, reason: "out_of_bounds" });
        } else if (!isPassable(state.map, nx, ny)) {
          moveBlockedByWall.add(id);
          actionResults.set(id, { action: Action.MOVE, dir: intent.dir, success: false, reason: "blocked_by_wall" });
        } else {
          moveTargets.set(id, { x: nx, y: ny });
        }
        // Update facing regardless
        players.set(id, { ...players.get(id)!, facing: intent.dir });
      }

      if (intent.action === Action.DASH && intent.dir) {
        const delta = DIRECTION_DELTAS[intent.dir];
        // Dash moves up to DASH_DISTANCE tiles — check each tile along path
        let fx = player.x;
        let fy = player.y;
        for (let step = 1; step <= DASH_DISTANCE; step++) {
          const nx = player.x + delta.x * step;
          const ny = player.y + delta.y * step;
          if (!isInBounds(nx, ny) || !isPassable(state.map, nx, ny)) break;
          fx = nx;
          fy = ny;
        }

        if (fx !== player.x || fy !== player.y) {
          moveTargets.set(id, { x: fx, y: fy });
        } else {
          // Dash didn't move at all — blocked
          actionResults.set(id, { action: Action.DASH, dir: intent.dir, success: false, reason: "blocked_by_wall" });
        }

        // Consume stamina and set cooldown
        const p = players.get(id)!;
        players.set(id, {
          ...p,
          facing: intent.dir,
          stamina: p.stamina - DASH_STAMINA_COST,
          cooldowns: { ...p.cooldowns, dash: DASH_COOLDOWN },
        });

        events.push({
          tick,
          type: "DASH",
          data: { playerId: id, dir: intent.dir },
        });
      }
    }

    // Resolve collision: if two players target the same tile, neither moves
    const targetOccupancy = new Map<string, string[]>();
    for (const [id, target] of moveTargets) {
      const key = `${target.x},${target.y}`;
      const list = targetOccupancy.get(key) ?? [];
      list.push(id);
      targetOccupancy.set(key, list);
    }

    // Also check if target is occupied by a non-moving player
    for (const [id, target] of moveTargets) {
      const key = `${target.x},${target.y}`;
      for (const [otherId, otherPlayer] of players) {
        if (otherId === id) continue;
        if (!otherPlayer.alive) continue;
        if (otherPlayer.x === target.x && otherPlayer.y === target.y && !moveTargets.has(otherId)) {
          // Target is occupied by a stationary player
          const list = targetOccupancy.get(key) ?? [];
          list.push(otherId); // mark as contested
          targetOccupancy.set(key, list);
        }
      }
    }

    for (const [id, target] of moveTargets) {
      const key = `${target.x},${target.y}`;
      const occupants = targetOccupancy.get(key);
      // Only move if no collision (sole occupant targeting this tile)
      if (occupants && occupants.length === 1 && occupants[0] === id) {
        const p = players.get(id)!;
        players.set(id, { ...p, x: target.x, y: target.y });
        // Record success if not already recorded (DASH sets its own)
        if (!actionResults.has(id)) {
          const intent = validIntents.get(id)!;
          actionResults.set(id, { action: intent.action, dir: intent.dir, success: true, reason: "ok" });
        }
      } else if (!moveBlockedByWall.has(id) && !actionResults.has(id)) {
        // Collision with another player
        const intent = validIntents.get(id)!;
        actionResults.set(id, { action: intent.action, dir: intent.dir, success: false, reason: "blocked_by_player" });
      }
    }

    // Record success for DASH moves that weren't blocked
    for (const [id, intent] of validIntents) {
      if (intent.action === Action.DASH && moveTargets.has(id) && !actionResults.has(id)) {
        const key = `${moveTargets.get(id)!.x},${moveTargets.get(id)!.y}`;
        const occupants = targetOccupancy.get(key);
        if (occupants && occupants.length === 1 && occupants[0] === id) {
          actionResults.set(id, { action: Action.DASH, dir: intent.dir, success: true, reason: "ok" });
        }
      }
    }

    // ── 3. Process SHOOT ──
    for (const [id, intent] of validIntents) {
      if (intent.action !== Action.SHOOT || !intent.dir) continue;
      const player = players.get(id)!;

      // Spawn projectile
      const tempState = { ...state, nextProjectileId };
      const { projectile, nextId } = spawnProjectile(tempState, {
        ...player,
        facing: intent.dir,
      });
      projectiles.push(projectile);
      nextProjectileId = nextId;

      // Consume ammo, set cooldown, update facing
      players.set(id, {
        ...player,
        facing: intent.dir,
        ammo: player.ammo - 1,
        cooldowns: { ...player.cooldowns, shoot: SHOOT_COOLDOWN },
      });

      events.push({
        tick,
        type: "SHOT",
        data: { playerId: id, dir: intent.dir },
      });

      // Record shoot success
      actionResults.set(id, { action: Action.SHOOT, dir: intent.dir, success: true, reason: "ok" });
    }

    // ── 5. Process PICKUP ──
    for (const [id, intent] of validIntents) {
      if (intent.action !== Action.PICKUP) continue;
      const player = players.get(id)!;

      // Find pickup on player's tile
      const pickupIdx = pickups.findIndex(
        (p) => p.x === player.x && p.y === player.y,
      );
      if (pickupIdx === -1) continue;

      const pickup = pickups[pickupIdx]!;
      const result = applyPickup(player, pickup, tick);
      players.set(id, {
        ...result.player,
        cooldowns: { ...result.player.cooldowns, pickup: PICKUP_COOLDOWN },
      });
      events.push(result.event);

      // Remove the pickup
      pickups = pickups.filter((_, i) => i !== pickupIdx);

      // Record pickup success
      actionResults.set(id, { action: Action.PICKUP, success: true, reason: "ok" });
    }

    // Record NOOP for players who submitted NOOP (or didn't submit at all)
    for (const [id, intent] of validIntents) {
      if (!actionResults.has(id) && intent.action === Action.NOOP) {
        actionResults.set(id, { action: Action.NOOP, success: true, reason: "ok" });
      }
    }
  }

  // ── 4. Advance projectiles (every tick, not just decision ticks) ──
  const projResult = tickProjectiles(projectiles, { ...state, players }, tick);
  projectiles = projResult.remaining;
  events.push(...projResult.events);

  // Apply player updates from projectile hits
  for (const [id, updated] of projResult.playerUpdates) {
    const current = players.get(id);
    if (current) {
      players.set(id, { ...current, ...updated, cooldowns: { ...current.cooldowns } });
    }
  }

  // ── 6. Zone tick ──
  const zoneResult = tickZone(state.zone, tick);
  events.push(...zoneResult.events);

  // Apply zone damage to players outside zone
  for (const [id, player] of players) {
    if (!player.alive) continue;
    const dmgResult = applyZoneDamage(player, zoneResult.zone, tick);
    if (dmgResult.event) {
      events.push(dmgResult.event);
    }
    if (dmgResult.died) {
      events.push({
        tick,
        type: "KILL",
        data: {
          killerId: null,
          victimId: id,
          weapon: "zone",
        },
      });
    }
    players.set(id, dmgResult.player);
  }

  // ── 7. Cooldown decrement ──
  for (const [id, player] of players) {
    if (!player.alive) continue;
    players.set(id, {
      ...player,
      cooldowns: {
        shoot: Math.max(0, player.cooldowns.shoot - 1),
        dash: Math.max(0, player.cooldowns.dash - 1),
        pickup: Math.max(0, player.cooldowns.pickup - 1),
      },
    });
  }

  // ── 8. Stamina regen ──
  for (const [id, player] of players) {
    if (!player.alive) continue;
    if (player.stamina < MAX_STAMINA) {
      players.set(id, {
        ...player,
        stamina: Math.min(MAX_STAMINA, player.stamina + STAMINA_REGEN_PER_TICK),
      });
    }
  }

  // ── 9. Spawn pickups ──
  const spawnResult = trySpawnPickups(
    { ...state, pickups, nextPickupId, tick },
    rng,
    tick,
  );
  pickups = [...pickups, ...spawnResult.pickups];
  nextPickupId = spawnResult.nextId;

  // ── 10. Check win condition ──
  let alivePlayers = 0;
  for (const p of players.values()) {
    if (p.alive) alivePlayers++;
  }

  const phase: GameState["phase"] =
    alivePlayers <= 1 && players.size > 1 ? "finished" : state.phase;

  // Accumulate events, keeping only the last 50 to prevent unbounded growth
  const allEvents = [...state.events, ...events];
  if (allEvents.length > 50) allEvents.splice(0, allEvents.length - 50);

  return {
    tick,
    seed: state.seed,
    map: state.map, // map is immutable, no need to clone
    players,
    projectiles,
    pickups,
    zone: zoneResult.zone,
    phase: phase as GameState["phase"],
    events: allEvents,
    nextProjectileId,
    nextPickupId,
    actionResults: isDecisionTick ? actionResults : state.actionResults,
  };
}

// ── Intent Validation ──

/** Validate an intent — return NOOP if invalid, with rejection reason */
function validateIntentWithReason(
  intent: Intent,
  player: PlayerState,
  state: GameState,
): { validated: Intent; rejectionReason?: ActionResult["reason"] } {
  switch (intent.action) {
    case Action.MOVE:
      if (!intent.dir) return { validated: { action: Action.NOOP } };
      return { validated: intent };

    case Action.DASH:
      if (!intent.dir) return { validated: { action: Action.NOOP } };
      if (player.cooldowns.dash > 0) return { validated: { action: Action.NOOP }, rejectionReason: "on_cooldown" };
      if (player.stamina < DASH_STAMINA_COST) return { validated: { action: Action.NOOP }, rejectionReason: "no_stamina" };
      return { validated: intent };

    case Action.SHOOT:
      if (!intent.dir) return { validated: { action: Action.NOOP } };
      if (player.cooldowns.shoot > 0) return { validated: { action: Action.NOOP }, rejectionReason: "on_cooldown" };
      if (player.ammo <= 0) return { validated: { action: Action.NOOP }, rejectionReason: "no_ammo" };
      return { validated: intent };

    case Action.PICKUP:
      if (player.cooldowns.pickup > 0) return { validated: { action: Action.NOOP }, rejectionReason: "on_cooldown" };
      const hasPickup = state.pickups.some(
        (p) => p.x === player.x && p.y === player.y,
      );
      if (!hasPickup) return { validated: { action: Action.NOOP }, rejectionReason: "no_pickup" };
      return { validated: intent };

    case Action.NOOP:
      return { validated: intent };

    default:
      return { validated: { action: Action.NOOP } };
  }
}

// ── Game Result Extraction ──

/** Extract final game result from finished state */
export function extractGameResult(state: GameState): GameResult | null {
  if (state.phase !== "finished") return null;

  // Build placements: alive player first, then by death tick (later = better)
  const playerList = Array.from(state.players.values());
  playerList.sort((a, b) => {
    if (a.alive && !b.alive) return -1;
    if (!a.alive && b.alive) return 1;
    if (!a.alive && !b.alive) {
      // Later death = better placement
      return (b.deathTick ?? 0) - (a.deathTick ?? 0);
    }
    return 0;
  });

  const placements: Placement[] = playerList.map((p, i) => ({
    playerId: p.id,
    name: p.name,
    placement: i + 1,
    kills: p.kills,
  }));

  const winner = playerList.find((p) => p.alive);

  return {
    winnerId: winner?.id ?? null,
    reason: "last_standing",
    placements,
    totalTicks: state.tick,
    seed: state.seed,
  };
}
