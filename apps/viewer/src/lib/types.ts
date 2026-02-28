/** Viewer-side types for arena state received via WebSocket */

export interface ViewerRobotState {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number, number]; // quaternion xyzw
  armAngles: [number, number]; // [left, right]
}

export interface ViewerStateMessage {
  type: "state";
  tick: number;
  time: number;
  robots: [ViewerRobotState, ViewerRobotState];
  matchPhase: "waiting" | "countdown" | "active" | "finished";
}

export interface MatchEndMessage {
  type: "match_end";
  winner: 0 | 1 | null;
  reason: "ring_out" | "timeout" | "disconnect";
}

export type ServerViewerMessage = ViewerStateMessage | MatchEndMessage;
