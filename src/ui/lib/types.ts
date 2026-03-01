/** Viewer-side types for grid arena state received via WebSocket */

import type { Direction, PickupKind, GamePhase } from "../../shared/types.js";

export type { Direction, PickupKind, GamePhase };

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

export type ServerViewerMessage = ViewerStateMessage | ViewerLobbyMessage | ViewerGameOverMessage;

/** Leaderboard entry from REST API */
export interface LeaderboardEntry {
  name: string;
  elo: number;
  wins: number;
  losses: number;
  gamesPlayed: number;
}
