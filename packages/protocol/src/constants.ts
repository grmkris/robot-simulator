// ── Physics ──
export const TICK_RATE = 60;
export const TICK_DURATION_S = 1 / TICK_RATE;
export const TICK_DURATION_MS = 1000 / TICK_RATE;

// ── Arena ──
export const ARENA_RADIUS = 10;
export const ARENA_FLOOR_Y = 0;

// ── Robot Chassis ──
export const CHASSIS_HALF_EXTENTS = { x: 0.5, y: 0.3, z: 0.5 } as const;
export const CHASSIS_MASS = 5; // kg

// ── Robot Arms ──
export const ARM_HALF_EXTENTS = { x: 0.1, y: 0.1, z: 0.6 } as const;
export const ARM_MASS = 1; // kg
export const ARM_ANGLE_MIN = -Math.PI / 4; // -45 degrees
export const ARM_ANGLE_MAX = Math.PI / 4; // +45 degrees
export const ARM_MOTOR_STIFFNESS = 40; // Nm/rad — tuned for stable joints
export const ARM_MOTOR_DAMPING = 8; // Nm*s/rad

// ── Chassis Drive (auto-approach toward opponent) ──
export const CHASSIS_DRIVE_FORCE = 6; // Newtons — gentle forward push
export const CHASSIS_MAX_SPEED = 1.5; // m/s — velocity cap

// ── Match Rules ──
export const MATCH_DURATION_S = 60;
export const MATCH_DURATION_TICKS = MATCH_DURATION_S * TICK_RATE;
export const RING_OUT_Y_THRESHOLD = -2;
export const RING_OUT_DISTANCE_MARGIN = 1; // beyond arena radius

// ── Protocol ──
export const PROTOCOL_VERSION = 1;
export const MAX_AGENTS = 2;
export const VIEWER_BROADCAST_RATE = 20; // Hz
export const VIEWER_BROADCAST_INTERVAL = Math.floor(TICK_RATE / VIEWER_BROADCAST_RATE);
