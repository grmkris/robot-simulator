// ═══════════════════════════════════════════════
// Fog of War — Square (Chebyshev) visibility
// ═══════════════════════════════════════════════

import { VISION_RADIUS, MAX_VISIBLE_TILES, MAX_RECENT_EVENTS } from "../shared/constants.js";
import { TileType, type GameState, type Observation, type Vec2 } from "../shared/types.js";
import { getTile, isInBounds } from "./grid-map.js";

/** Check if target position is visible from observer position (Chebyshev distance) */
export function isVisible(observer: Vec2, target: Vec2): boolean {
  return (
    Math.abs(target.x - observer.x) <= VISION_RADIUS &&
    Math.abs(target.y - observer.y) <= VISION_RADIUS
  );
}

/** Build a fog-filtered observation for a specific player */
export function buildObservation(
  state: GameState,
  playerId: string,
  matchId: string,
): Observation | null {
  const player = state.players.get(playerId);
  if (!player) return null;

  const pos: Vec2 = { x: player.x, y: player.y };

  // Visible tiles (17x17 window)
  const tiles: Observation["visible"]["tiles"] = [];
  const minX = player.x - VISION_RADIUS;
  const maxX = player.x + VISION_RADIUS;
  const minY = player.y - VISION_RADIUS;
  const maxY = player.y + VISION_RADIUS;

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      if (isInBounds(x, y)) {
        const t = getTile(state.map, x, y);
        // Only include non-empty tiles to save tokens
        if (t !== TileType.EMPTY) {
          tiles.push({ x, y, t });
        }
      }
    }
  }

  // Visible enemies
  const enemies: Observation["visible"]["enemies"] = [];
  for (const [id, p] of state.players) {
    if (id === playerId || !p.alive) continue;
    if (isVisible(pos, { x: p.x, y: p.y })) {
      enemies.push({
        id: p.id,
        x: p.x,
        y: p.y,
        hp: p.hp,
        shield: p.shield,
      });
    }
  }

  // Visible pickups
  const pickups: Observation["visible"]["pickups"] = [];
  for (const pickup of state.pickups) {
    if (isVisible(pos, { x: pickup.x, y: pickup.y })) {
      pickups.push({
        id: pickup.id,
        kind: pickup.kind,
        x: pickup.x,
        y: pickup.y,
      });
    }
  }

  // Visible projectiles
  const projectiles: Observation["visible"]["projectiles"] = [];
  for (const proj of state.projectiles) {
    if (isVisible(pos, { x: proj.x, y: proj.y })) {
      projectiles.push({
        id: proj.id,
        x: proj.x,
        y: proj.y,
        dir: proj.dir,
        own: proj.ownerId === playerId,
      });
    }
  }

  // Recent events (last MAX_RECENT_EVENTS, global — kills are important intel)
  const recentEvents = state.events.slice(-MAX_RECENT_EVENTS);

  // Count alive players
  let playersAlive = 0;
  for (const p of state.players.values()) {
    if (p.alive) playersAlive++;
  }

  // Decision index = how many decision ticks have passed
  const decisionIndex = Math.floor(state.tick / 5);

  // Last action result for this player
  const lastAction = state.actionResults.get(playerId);

  return {
    matchId,
    tick: state.tick,
    decisionIndex,
    self: {
      id: player.id,
      x: player.x,
      y: player.y,
      hp: player.hp,
      shield: player.shield,
      stamina: player.stamina,
      ammo: player.ammo,
      facing: player.facing,
      cooldowns: { ...player.cooldowns },
    },
    zone: {
      cx: state.zone.cx,
      cy: state.zone.cy,
      r: state.zone.r,
    },
    visible: {
      tiles: tiles.slice(0, MAX_VISIBLE_TILES),
      enemies,
      pickups,
      projectiles,
    },
    recentEvents,
    playersAlive,
    lastAction,
  };
}
