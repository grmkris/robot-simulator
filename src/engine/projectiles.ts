// ═══════════════════════════════════════════════
// Projectile System — Grid-based deterministic
// ═══════════════════════════════════════════════

import { PROJECTILE_DAMAGE, PROJECTILE_SPEED, PROJECTILE_TTL } from "../shared/constants.js";
import {
  DIRECTION_DELTAS,
  type GameEvent,
  type GameState,
  type PlayerState,
  type Projectile,
} from "../shared/types.js";
import { isProjectilePassable, isInBounds } from "./grid-map.js";

/** Spawn a new projectile from a player's position in their facing direction */
export function spawnProjectile(
  state: GameState,
  player: PlayerState,
): { projectile: Projectile; nextId: number } {
  const delta = DIRECTION_DELTAS[player.facing];
  // Spawn 1 tile ahead of the player
  const projectile: Projectile = {
    id: state.nextProjectileId,
    ownerId: player.id,
    x: player.x + delta.x,
    y: player.y + delta.y,
    dir: player.facing,
    ttl: PROJECTILE_TTL,
  };
  return { projectile, nextId: state.nextProjectileId + 1 };
}

/** Advance all projectiles by 1 tile, detect hits, clean up expired */
export function tickProjectiles(
  projectiles: Projectile[],
  state: GameState,
  tick: number,
): {
  remaining: Projectile[];
  playerUpdates: Map<string, PlayerState>;
  events: GameEvent[];
} {
  const remaining: Projectile[] = [];
  const playerUpdates = new Map<string, PlayerState>();
  const events: GameEvent[] = [];

  for (const proj of projectiles) {
    // Move projectile
    const delta = DIRECTION_DELTAS[proj.dir];
    const nx = proj.x + delta.x * PROJECTILE_SPEED;
    const ny = proj.y + delta.y * PROJECTILE_SPEED;
    const newTtl = proj.ttl - 1;

    // Check out of bounds or expired
    if (!isInBounds(nx, ny) || newTtl <= 0) {
      continue; // despawn
    }

    // Check tile collision (WALL or COVER blocks projectiles)
    if (!isProjectilePassable(state.map, nx, ny)) {
      continue; // despawn on wall/cover
    }

    // Check player collision
    let hit = false;
    for (const [id, player] of state.players) {
      // Don't hit owner, don't hit dead players
      if (id === proj.ownerId || !player.alive) continue;

      // Get latest state (might have been updated by earlier projectile)
      const currentPlayer = playerUpdates.get(id) ?? player;
      if (!currentPlayer.alive) continue;

      if (currentPlayer.x === nx && currentPlayer.y === ny) {
        // Hit!
        const damaged = applyProjectileDamage(currentPlayer, proj, tick);
        playerUpdates.set(id, damaged.player);
        events.push(...damaged.events);

        if (damaged.killed) {
          // Credit the kill to the projectile owner
          const owner = playerUpdates.get(proj.ownerId) ?? state.players.get(proj.ownerId);
          if (owner) {
            playerUpdates.set(proj.ownerId, {
              ...owner,
              kills: owner.kills + 1,
            });
          }
          events.push({
            tick,
            type: "KILL",
            data: {
              killerId: proj.ownerId,
              victimId: id,
              weapon: "projectile",
            },
          });
        }

        hit = true;
        break; // projectile consumed
      }
    }

    if (!hit) {
      remaining.push({
        ...proj,
        x: nx,
        y: ny,
        ttl: newTtl,
      });
    }
  }

  return { remaining, playerUpdates, events };
}

/** Apply projectile damage to a player (shield absorbs first) */
function applyProjectileDamage(
  player: PlayerState,
  proj: Projectile,
  tick: number,
): { player: PlayerState; killed: boolean; events: GameEvent[] } {
  let { shield, hp } = player;
  let remaining = PROJECTILE_DAMAGE;
  const events: GameEvent[] = [];

  // Shield absorbs first
  if (shield > 0) {
    const absorbed = Math.min(shield, remaining);
    shield -= absorbed;
    remaining -= absorbed;
  }

  hp -= remaining;
  const killed = hp <= 0;

  events.push({
    tick,
    type: "DAMAGE",
    data: {
      targetId: player.id,
      sourceId: proj.ownerId,
      damage: PROJECTILE_DAMAGE,
      source: "projectile",
    },
  });

  return {
    player: {
      ...player,
      hp: Math.max(0, hp),
      shield,
      alive: !killed,
      deathTick: killed ? tick : player.deathTick,
    },
    killed,
    events,
  };
}
