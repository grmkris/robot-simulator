/** Viewer-side types for arena state received via WebSocket */

export interface ViewerRobotState {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion xyzw
  armAngles: [number, number]; // [left, right]
}

/** Projectile state for viewer rendering */
export interface ViewerProjectileState {
  position: [number, number, number];
  ownerId: 0 | 1;
}

/** Agent thoughts for Mind Games mode */
export interface AgentThoughts {
  thought: string | null;
  privateThought: string | null;
}

export interface ViewerStateMessage {
  type: "state";
  tick: number;
  time: number;
  robots: [ViewerRobotState, ViewerRobotState];
  matchPhase: "waiting" | "countdown" | "active" | "finished";
  /** Active projectiles */
  projectiles?: ViewerProjectileState[];
  /** Agent thoughts (Mind Games) */
  thoughts?: {
    A: AgentThoughts;
    B: AgentThoughts;
  };
  /** Current decision round */
  round?: number;
  /** Agent display names */
  agentNames?: { A: string; B: string };
}

export interface MatchEndMessage {
  type: "match_end";
  winner: 0 | 1 | null;
  reason: "ring_out" | "timeout" | "disconnect";
}

/** Lobby state broadcast by server */
export interface LobbyStateMessage {
  type: "lobby";
  queue: Array<{ name: string; position: number }>;
  currentMatch: {
    agentA: string;
    agentB: string;
    phase: string;
    tick: number;
    time: number;
  } | null;
}

/** Leaderboard entry from REST API */
export interface LeaderboardEntry {
  rank: number;
  agentName: string;
  displayName: string;
  wins: number;
  losses: number;
  draws: number;
  elo: number;
  matches: number;
  winRate: number;
}

/** Match history entry from REST API */
export interface MatchHistoryEntry {
  matchId: string;
  timestamp: string;
  agentA: string;
  agentB: string;
  winner: 0 | 1 | null;
  reason: string;
  durationS: number;
}

export type ServerViewerMessage = ViewerStateMessage | MatchEndMessage | LobbyStateMessage;
