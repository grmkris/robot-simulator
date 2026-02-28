/** 3D vector — plain serializable object */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Quaternion rotation */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Rigid body state snapshot (serializable) */
export interface BodyState {
  position: Vec3;
  rotation: Quat;
  linvel: Vec3;
  angvel: Vec3;
}

/** Per-arm state */
export interface ArmState {
  body: BodyState;
  currentAngle: number; // radians, actual joint angle
  targetAngle: number; // normalized [-1, 1]
}

/** Complete robot state for one agent */
export interface RobotState {
  id: AgentId;
  chassis: BodyState;
  leftArm: ArmState;
  rightArm: ArmState;
  isAlive: boolean;
}

/** An action submitted by an agent: target angles normalized to [-1, 1] */
export interface AgentAction {
  leftArmTarget: number;
  rightArmTarget: number;
}

/** Full world snapshot at a given tick */
export interface WorldState {
  tick: number;
  elapsed: number; // seconds since match start
  robots: [RobotState, RobotState];
  matchPhase: MatchPhase;
}

/** Agent identifier: 0 or 1 */
export type AgentId = 0 | 1;

/** Match lifecycle phases */
export type MatchPhase = "waiting" | "countdown" | "active" | "finished";

/** Match outcome */
export interface MatchResult {
  winner: AgentId | null; // null = draw
  reason: "ring_out" | "timeout" | "disconnect";
  finalTick: number;
}

/** Viewer-optimized state (sent at VIEWER_BROADCAST_RATE) */
export interface ViewerRobotState {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
  armAngles: [number, number];
}

export interface ViewerState {
  type: "state";
  tick: number;
  time: number;
  robots: [ViewerRobotState, ViewerRobotState];
  matchPhase: MatchPhase;
}
