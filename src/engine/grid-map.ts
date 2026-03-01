// ═══════════════════════════════════════════════
// Grid Map — 40x40 tile grid
// ═══════════════════════════════════════════════

import { GRID_W, GRID_H } from "../shared/constants.js";
import { TileType, type GridMap } from "../shared/types.js";
import type { SeededRNG } from "./rng.js";

/** Create a new empty grid map */
export function createEmptyMap(): GridMap {
  return {
    width: GRID_W,
    height: GRID_H,
    tiles: new Uint8Array(GRID_W * GRID_H), // all EMPTY (0)
  };
}

/** Generate a map with some wall clusters for cover */
export function createMap(rng: SeededRNG): GridMap {
  const map = createEmptyMap();

  // Place wall clusters — ~5-8 clusters of 2-5 walls each
  const clusterCount = rng.nextIntRange(5, 8);
  for (let c = 0; c < clusterCount; c++) {
    // Pick a cluster center away from edges (leave 3-tile border)
    const cx = rng.nextIntRange(4, GRID_W - 5);
    const cy = rng.nextIntRange(4, GRID_H - 5);

    // Place 2-5 walls in a connected cluster
    const wallCount = rng.nextIntRange(2, 5);
    let wx = cx;
    let wy = cy;
    for (let w = 0; w < wallCount; w++) {
      if (isInBounds(wx, wy)) {
        setTile(map, wx, wy, TileType.WALL);
      }
      // Random walk for next wall position
      const dir = rng.nextInt(4);
      if (dir === 0) wx++;
      else if (dir === 1) wx--;
      else if (dir === 2) wy++;
      else wy--;
    }
  }

  // Place some cover tiles — ~6-10 scattered
  const coverCount = rng.nextIntRange(6, 10);
  for (let i = 0; i < coverCount; i++) {
    const x = rng.nextIntRange(3, GRID_W - 4);
    const y = rng.nextIntRange(3, GRID_H - 4);
    if (getTile(map, x, y) === TileType.EMPTY) {
      setTile(map, x, y, TileType.COVER);
    }
  }

  return map;
}

/** Check if coordinates are within grid bounds */
export function isInBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_W && y >= 0 && y < GRID_H;
}

/** Get tile type at (x, y) */
export function getTile(map: GridMap, x: number, y: number): TileType {
  if (!isInBounds(x, y)) return TileType.WALL; // out of bounds = wall
  return map.tiles[y * map.width + x]! as TileType;
}

/** Set tile type at (x, y) */
export function setTile(map: GridMap, x: number, y: number, type: TileType): void {
  if (isInBounds(x, y)) {
    map.tiles[y * map.width + x] = type;
  }
}

/** Check if a tile is passable (can be walked on) */
export function isPassable(map: GridMap, x: number, y: number): boolean {
  const tile = getTile(map, x, y);
  // WALL blocks movement, everything else is walkable
  return tile !== TileType.WALL;
}

/** Check if a projectile can pass through a tile */
export function isProjectilePassable(map: GridMap, x: number, y: number): boolean {
  const tile = getTile(map, x, y);
  // Both WALL and COVER block projectiles
  return tile !== TileType.WALL && tile !== TileType.COVER;
}

/** Clone a grid map (for state immutability) */
export function cloneMap(map: GridMap): GridMap {
  return {
    width: map.width,
    height: map.height,
    tiles: new Uint8Array(map.tiles),
  };
}
