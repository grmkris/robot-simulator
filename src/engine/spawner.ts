// ═══════════════════════════════════════════════
// Player Spawn Positions
// ═══════════════════════════════════════════════

import { GRID_W, GRID_H } from "../shared/constants.js";
import { Direction, TileType, type Vec2 } from "../shared/types.js";
import type { GridMap } from "../shared/types.js";
import { getTile } from "./grid-map.js";
import type { SeededRNG } from "./rng.js";

/** Generate spawn positions around the map perimeter, evenly spaced */
export function generateSpawnPositions(
  playerCount: number,
  map: GridMap,
  rng: SeededRNG,
): Array<{ pos: Vec2; facing: Direction }> {
  const spawns: Array<{ pos: Vec2; facing: Direction }> = [];
  const centerX = Math.floor(GRID_W / 2);
  const centerY = Math.floor(GRID_H / 2);

  // Place players in a ring around the map center, ~3 tiles from the edge
  const margin = 3;
  const ringRadius = Math.floor(Math.min(GRID_W, GRID_H) / 2) - margin;

  for (let i = 0; i < playerCount; i++) {
    // Distribute evenly around a circle, with random offset for variety
    const angle = (2 * Math.PI * i) / playerCount + rng.next() * 0.3;
    let x = Math.round(centerX + ringRadius * Math.cos(angle));
    let y = Math.round(centerY + ringRadius * Math.sin(angle));

    // Clamp to grid bounds with margin
    x = Math.max(margin, Math.min(GRID_W - 1 - margin, x));
    y = Math.max(margin, Math.min(GRID_H - 1 - margin, y));

    // Nudge if landing on a wall
    const nudged = findNearestPassable(map, x, y);
    x = nudged.x;
    y = nudged.y;

    // Face toward center
    const dx = centerX - x;
    const dy = centerY - y;
    let facing: Direction;
    if (Math.abs(dx) >= Math.abs(dy)) {
      facing = dx > 0 ? Direction.E : Direction.W;
    } else {
      facing = dy > 0 ? Direction.S : Direction.N;
    }

    spawns.push({ pos: { x, y }, facing });
  }

  return spawns;
}

/** Find nearest passable tile via BFS spiral */
function findNearestPassable(map: GridMap, x: number, y: number): Vec2 {
  if (getTile(map, x, y) !== TileType.WALL) {
    return { x, y };
  }

  // Spiral outward
  for (let r = 1; r <= 5; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) === r || Math.abs(dy) === r) {
          const nx = x + dx;
          const ny = y + dy;
          if (
            nx >= 0 && nx < GRID_W &&
            ny >= 0 && ny < GRID_H &&
            getTile(map, nx, ny) !== TileType.WALL
          ) {
            return { x: nx, y: ny };
          }
        }
      }
    }
  }

  // Fallback — shouldn't happen with our map gen
  return { x, y };
}
