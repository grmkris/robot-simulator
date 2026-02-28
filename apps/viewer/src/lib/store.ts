import { create } from "zustand";
import type {
  ViewerRobotState,
  ViewerStateMessage,
  MatchEndMessage,
  AgentThoughts,
} from "./types";

interface ArenaStore {
  // Connection
  connected: boolean;
  setConnected: (v: boolean) => void;

  // Match state
  tick: number;
  time: number;
  matchPhase: "waiting" | "countdown" | "active" | "finished" | "disconnected";
  robots: [ViewerRobotState, ViewerRobotState] | null;

  // Match result
  winner: 0 | 1 | null;
  winReason: string | null;

  // Interpolation: previous + current frame for lerping
  prevRobots: [ViewerRobotState, ViewerRobotState] | null;

  // Mind Games
  thoughts: { A: AgentThoughts; B: AgentThoughts } | null;
  round: number;
  agentNames: { A: string; B: string };

  // Actions
  updateState: (msg: ViewerStateMessage) => void;
  setMatchEnd: (msg: MatchEndMessage) => void;
  reset: () => void;
}

const defaultRobot: ViewerRobotState = {
  id: "A",
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  armAngles: [0, 0],
};

export const useArenaStore = create<ArenaStore>((set, get) => ({
  connected: false,
  setConnected: (v) => set({ connected: v }),

  tick: 0,
  time: 0,
  matchPhase: "disconnected",
  robots: null,
  winner: null,
  winReason: null,
  prevRobots: null,
  thoughts: null,
  round: 0,
  agentNames: { A: "Robot A", B: "Robot B" },

  updateState: (msg) =>
    set((state) => ({
      tick: msg.tick,
      time: msg.time,
      matchPhase: msg.matchPhase,
      prevRobots: state.robots,
      robots: msg.robots,
      thoughts: msg.thoughts ?? state.thoughts,
      round: msg.round ?? state.round,
      agentNames: msg.agentNames ?? state.agentNames,
    })),

  setMatchEnd: (msg) =>
    set({
      matchPhase: "finished",
      winner: msg.winner,
      winReason: msg.reason,
    }),

  reset: () =>
    set({
      tick: 0,
      time: 0,
      matchPhase: "disconnected",
      robots: null,
      winner: null,
      winReason: null,
      prevRobots: null,
      thoughts: null,
      round: 0,
      agentNames: { A: "Robot A", B: "Robot B" },
    }),
}));
