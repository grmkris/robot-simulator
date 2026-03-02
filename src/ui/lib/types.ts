/** Viewer-side types for grid arena state received via WebSocket */

import type { Direction, PickupKind, GamePhase, Action } from "../../shared/types.js";

export type { Direction, PickupKind, GamePhase, Action };

// ── Viewer State Types ──

export interface ViewerPlayer {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  shield: number;
  stamina: number;
  ammo: number;
  facing: Direction;
  alive: boolean;
  kills: number;
}

export interface ViewerProjectile {
  id: number;
  ownerId: string;
  x: number;
  y: number;
  dir: Direction;
}

export interface ViewerPickup {
  id: number;
  kind: PickupKind;
  x: number;
  y: number;
}

export interface ViewerZone {
  cx: number;
  cy: number;
  r: number;
}

export interface ViewerKillEvent {
  tick: number;
  killerId: string | null;
  victimId: string;
  victimName: string;
  killerName: string | null;
  weapon: "projectile" | "zone";
}

// ── Player Action Entry (for command history) ──

export interface ViewerActionEntry {
  playerId: string;
  playerName: string;
  action: Action;
  dir?: Direction;
  success: boolean;
  reason?: string;
}

// ── WebSocket Messages ──

export interface ViewerStateMessage {
  type: "state";
  tick: number;
  phase: GamePhase;
  players: ViewerPlayer[];
  projectiles: ViewerProjectile[];
  pickups: ViewerPickup[];
  zone: ViewerZone;
  killFeed: ViewerKillEvent[];
  playersAlive: number;
  lastActions?: ViewerActionEntry[];
}

export interface ViewerLobbyMessage {
  type: "lobby";
  players: Array<{ name: string; ready: boolean }>;
  countdown: number | null;
  phase: GamePhase;
}

export interface ViewerGameOverMessage {
  type: "game_over";
  winnerId: string | null;
  winnerName: string | null;
  reason: string;
  placements: Array<{
    playerId: string;
    name: string;
    placement: number;
    kills: number;
  }>;
}

export interface ViewerCatchUpMessage {
  type: "catch_up";
  frames: ViewerStateMessage[];
}

export type ServerViewerMessage = ViewerStateMessage | ViewerLobbyMessage | ViewerGameOverMessage | ViewerCatchUpMessage;

/** Leaderboard entry from REST API */
export interface LeaderboardEntry {
  name: string;
  elo: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
}
