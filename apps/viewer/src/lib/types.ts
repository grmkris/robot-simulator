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

export type ServerViewerMessage = ViewerStateMessage | MatchEndMessage;
