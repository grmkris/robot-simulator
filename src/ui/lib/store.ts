import { create } from "zustand";
import type {
  ViewerPlayer,
  ViewerProjectile,
  ViewerPickup,
  ViewerZone,
  ViewerKillEvent,
  ViewerStateMessage,
  ViewerLobbyMessage,
  ViewerGameOverMessage,
  GamePhase,
} from "./types";

interface GridRoyaleStore {
  connected: boolean;
  setConnected: (v: boolean) => void;

  // Game state
  tick: number;
  phase: GamePhase;
  players: ViewerPlayer[];
  projectiles: ViewerProjectile[];
  pickups: ViewerPickup[];
  zone: ViewerZone;
  killFeed: ViewerKillEvent[];
  playersAlive: number;

  // Game over
  winnerId: string | null;
  winnerName: string | null;
  winReason: string | null;
  placements: ViewerGameOverMessage["placements"];

  // Lobby
  lobbyPlayers: Array<{ name: string; ready: boolean }>;
  countdown: number | null;

  // Actions
  updateState: (msg: ViewerStateMessage) => void;
  updateLobby: (msg: ViewerLobbyMessage) => void;
  setGameOver: (msg: ViewerGameOverMessage) => void;
  reset: () => void;
}

const INITIAL_ZONE: ViewerZone = { cx: 20, cy: 20, r: 20 };

export const useArenaStore = create<GridRoyaleStore>((set) => ({
  connected: false,
  setConnected: (v) => set({ connected: v }),

  tick: 0,
  phase: "lobby",
  players: [],
  projectiles: [],
  pickups: [],
  zone: INITIAL_ZONE,
  killFeed: [],
  playersAlive: 0,

  winnerId: null,
  winnerName: null,
  winReason: null,
  placements: [],

  lobbyPlayers: [],
  countdown: null,

  updateState: (msg) =>
    set({
      tick: msg.tick,
      phase: msg.phase,
      players: msg.players,
      projectiles: msg.projectiles,
      pickups: msg.pickups,
      zone: msg.zone,
      killFeed: msg.killFeed,
      playersAlive: msg.playersAlive,
    }),

  updateLobby: (msg) =>
    set({
      lobbyPlayers: msg.players,
      countdown: msg.countdown,
      phase: msg.phase,
    }),

  setGameOver: (msg) =>
    set({
      phase: "finished",
      winnerId: msg.winnerId,
      winnerName: msg.winnerName,
      winReason: msg.reason,
      placements: msg.placements,
    }),

  reset: () =>
    set({
      tick: 0,
      phase: "lobby",
      players: [],
      projectiles: [],
      pickups: [],
      zone: INITIAL_ZONE,
      killFeed: [],
      playersAlive: 0,
      winnerId: null,
      winnerName: null,
      winReason: null,
      placements: [],
      lobbyPlayers: [],
      countdown: null,
    }),
}));
