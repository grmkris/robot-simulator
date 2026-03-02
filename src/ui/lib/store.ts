import { create } from "zustand";
import type {
  ViewerPlayer,
  ViewerProjectile,
  ViewerPickup,
  ViewerZone,
  ViewerKillEvent,
  ViewerActionEntry,
  ViewerStateMessage,
  ViewerLobbyMessage,
  ViewerGameOverMessage,
  GamePhase,
} from "./types";

/** One tick's worth of player actions */
export interface CommandHistoryEntry {
  tick: number;
  entries: ViewerActionEntry[];
}

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

  // Command history
  lastActions: ViewerActionEntry[];
  commandHistory: CommandHistoryEntry[];

  // Game over
  winnerId: string | null;
  winnerName: string | null;
  winReason: string | null;
  placements: ViewerGameOverMessage["placements"];

  // Lobby
  lobbyPlayers: Array<{ name: string; ready: boolean }>;
  countdown: number | null;

  // Catch-up replay
  catchUpMode: boolean;
  catchUpFrames: ViewerStateMessage[];
  catchUpIndex: number;
  catchUpPlaying: boolean;
  catchUpSpeedIdx: number;

  // Actions
  updateState: (msg: ViewerStateMessage) => void;
  updateLobby: (msg: ViewerLobbyMessage) => void;
  setGameOver: (msg: ViewerGameOverMessage) => void;
  enterCatchUp: (frames: ViewerStateMessage[]) => void;
  setCatchUpIndex: (idx: number) => void;
  setCatchUpPlaying: (playing: boolean) => void;
  setCatchUpSpeedIdx: (idx: number) => void;
  exitCatchUp: () => void;
  reset: () => void;
}

const INITIAL_ZONE: ViewerZone = { cx: 20, cy: 20, r: 20 };
const MAX_COMMAND_HISTORY = 100;

export const useArenaStore = create<GridRoyaleStore>((set, get) => ({
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

  lastActions: [],
  commandHistory: [],

  winnerId: null,
  winnerName: null,
  winReason: null,
  placements: [],

  lobbyPlayers: [],
  countdown: null,

  catchUpMode: false,
  catchUpFrames: [],
  catchUpIndex: 0,
  catchUpPlaying: false,
  catchUpSpeedIdx: 1,

  updateState: (msg) =>
    set((state) => {
      const newActions = msg.lastActions ?? [];
      const newHistory =
        newActions.length > 0
          ? [...state.commandHistory.slice(-(MAX_COMMAND_HISTORY - 1)), { tick: msg.tick, entries: newActions }]
          : state.commandHistory;

      return {
        tick: msg.tick,
        phase: msg.phase,
        players: msg.players,
        projectiles: msg.projectiles,
        pickups: msg.pickups,
        zone: msg.zone,
        killFeed: msg.killFeed,
        playersAlive: msg.playersAlive,
        lastActions: newActions,
        commandHistory: newHistory,
      };
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
      catchUpMode: false,
      catchUpPlaying: false,
    }),

  enterCatchUp: (frames) => {
    if (frames.length === 0) return;
    // Show first frame immediately
    const first = frames[0]!;
    set({
      catchUpMode: true,
      catchUpFrames: frames,
      catchUpIndex: 0,
      catchUpPlaying: true,
      catchUpSpeedIdx: 3, // Start at 4x for quick catch-up
      // Apply first frame to display state
      tick: first.tick,
      phase: first.phase,
      players: first.players,
      projectiles: first.projectiles,
      pickups: first.pickups,
      zone: first.zone,
      killFeed: first.killFeed,
      playersAlive: first.playersAlive,
      lastActions: first.lastActions ?? [],
      commandHistory: [],
    });
  },

  setCatchUpIndex: (idx) => {
    const { catchUpFrames, updateState } = get();
    if (idx < 0 || idx >= catchUpFrames.length) return;
    set({ catchUpIndex: idx });
    updateState(catchUpFrames[idx]!);
  },

  setCatchUpPlaying: (playing) => set({ catchUpPlaying: playing }),

  setCatchUpSpeedIdx: (idx) => set({ catchUpSpeedIdx: idx }),

  exitCatchUp: () =>
    set({
      catchUpMode: false,
      catchUpFrames: [],
      catchUpIndex: 0,
      catchUpPlaying: false,
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
      lastActions: [],
      commandHistory: [],
      winnerId: null,
      winnerName: null,
      winReason: null,
      placements: [],
      lobbyPlayers: [],
      countdown: null,
      catchUpMode: false,
      catchUpFrames: [],
      catchUpIndex: 0,
      catchUpPlaying: false,
      catchUpSpeedIdx: 1,
    }),
}));
