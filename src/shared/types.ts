// ═══════════════════════════════════════════════
// GridRoyale — Core Types
// ═══════════════════════════════════════════════

// ── Coordinates ──

export interface Vec2 {
  x: number;
  y: number;
}

// ── Enums ──

export enum Direction {
  N = "N",
  E = "E",
  S = "S",
  W = "W",
}

export enum Action {
  MOVE = "MOVE",
  DASH = "DASH",
  SHOOT = "SHOOT",
  PICKUP = "PICKUP",
  NOOP = "NOOP",
}

export enum TileType {
  EMPTY = 0,
  WALL = 1,
  COVER = 2,
  HAZARD = 3,
}

export enum PickupKind {
  MEDKIT = "MEDKIT",
  SHIELD = "SHIELD",
  AMMO = "AMMO",
  STAMINA = "STAMINA",
}

export type GamePhase = "lobby" | "countdown" | "active" | "finished";

// ── Direction Helpers ──

export const DIRECTION_DELTAS: Record<Direction, Vec2> = {
  [Direction.N]: { x: 0, y: -1 },
  [Direction.E]: { x: 1, y: 0 },
  [Direction.S]: { x: 0, y: 1 },
  [Direction.W]: { x: -1, y: 0 },
};

// ── Intent (what a bot submits) ──

export interface Intent {
  action: Action;
  dir?: Direction;
}

// ── Player State ──

export interface Cooldowns {
  shoot: number;
  dash: number;
  pickup: number;
}

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  shield: number;
  stamina: number;
  ammo: number;
  facing: Direction;
  cooldowns: Cooldowns;
  alive: boolean;
  kills: number;
  /** Tick the player died on (for placement ordering) */
  deathTick: number | null;
}

// ── Projectile ──

export interface Projectile {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  dir: Direction;
  ttl: number;
}

// ── Pickup ──

export interface Pickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

// ── Zone ──

export interface ZoneState {
  cx: number;
  cy: number;
  /** Radius — distance from center. Tiles with max(|dx|,|dy|) > r are outside */
  r: number;
  nextShrinkTick: number;
  phase: number;
}

// ── Grid Map ──

export interface GridMap {
  width: number;
  height: number;
  tiles: Uint8Array;
}

// ── Game Events ──

export type GameEventType =
  | "DAMAGE"
  | "KILL"
  | "PICKUP"
  | "ZONE_SHRINK"
  | "SHOT"
  | "DASH";

export interface GameEvent {
  tick: number;
  type: GameEventType;
  data: Record<string, unknown>;
}

// ── Full Game State (server-side, omniscient) ──

export interface GameState {
  tick: number;
  seed: number;
  map: GridMap;
  players: Map<string, PlayerState>;
  projectiles: Projectile[];
  pickups: Pickup[];
  zone: ZoneState;
  phase: GamePhase;
  events: GameEvent[];
  nextProjectileId: number;
  nextPickupId: number;
}

// ── Observation (fog-filtered, per-player, per spec section 11) ──

export interface Observation {
  matchId: string;
  tick: number;
  decisionIndex: number;
  self: {
    id: string;
    x: number;
    y: number;
    hp: number;
    shield: number;
    stamina: number;
    ammo: number;
    facing: Direction;
    cooldowns: Cooldowns;
  };
  zone: {
    cx: number;
    cy: number;
    r: number;
  };
  visible: {
    tiles: Array<{ x: number; y: number; t: TileType }>;
    enemies: Array<{
      id: string;
      x: number;
      y: number;
      hp: number;
      shield: number;
    }>;
    pickups: Array<{ id: number; kind: PickupKind; x: number; y: number }>;
    projectiles: Array<{
      id: number;
      x: number;
      y: number;
      dir: Direction;
    }>;
  };
  recentEvents: GameEvent[];
  playersAlive: number;
}

// ── Match Result ──

export interface Placement {
  playerId: string;
  name: string;
  placement: number;
  kills: number;
}

export interface GameResult {
  winnerId: string | null;
  reason: "last_standing" | "zone_collapse" | "timeout";
  placements: Placement[];
  totalTicks: number;
  seed: number;
}

// ── Intent Log Entry (for replay) ──

export interface IntentLogEntry {
  tick: number;
  playerId: string;
  intent: Intent;
}

// ── Leaderboard / History ──

export interface LeaderboardEntry {
  agentName: string;
  displayName: string;
  wins: number;
  losses: number;
  elo: number;
  matches: number;
  winRate: number;
  avgPlacement: number;
}

export interface MatchHistoryEntry {
  gameId: string;
  timestamp: string;
  playerCount: number;
  winnerId: string | null;
  winnerName: string | null;
  reason: string;
  durationS: number;
}
