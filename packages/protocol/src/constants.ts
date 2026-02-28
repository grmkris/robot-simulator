// ── Physics ──
export const TICK_RATE = 60;
export const TICK_DURATION_S = 1 / TICK_RATE;
export const TICK_DURATION_MS = 1000 / TICK_RATE;

// ── Arena ──
export const ARENA_RADIUS = 5; // Smaller arena = faster confrontations
export const ARENA_FLOOR_Y = 0;

// ── Robot Chassis ──
export const CHASSIS_HALF_EXTENTS = { x: 0.5, y: 0.3, z: 0.5 } as const;
export const CHASSIS_MASS = 5; // kg

// ── Robot Arms ──
export const ARM_HALF_EXTENTS = { x: 0.12, y: 0.12, z: 0.7 } as const; // Slightly beefier arms
export const ARM_MASS = 1.5; // kg — heavier arms = more punch impact
export const ARM_ANGLE_MIN = -Math.PI / 2.5; // -72 degrees — wider swing
export const ARM_ANGLE_MAX = Math.PI / 2.5; // +72 degrees — wider swing
export const ARM_MOTOR_STIFFNESS = 120; // Nm/rad — snappy responsive arms
export const ARM_MOTOR_DAMPING = 4; // Nm*s/rad — very snappy swings

// ── Chassis Drive (auto-approach toward opponent) ──
export const CHASSIS_DRIVE_FORCE = 35; // Newtons — very aggressive charge
export const CHASSIS_MAX_SPEED = 5; // m/s — fast closing speed

// ── Match Rules ──
export const MATCH_DURATION_S = 45; // Shorter, tighter matches
export const MATCH_DURATION_TICKS = MATCH_DURATION_S * TICK_RATE;
export const RING_OUT_Y_THRESHOLD = -2;
export const RING_OUT_DISTANCE_MARGIN = 1; // beyond arena radius

// ── Protocol ──
export const PROTOCOL_VERSION = 3;
export const MAX_AGENTS = 2;
export const VIEWER_BROADCAST_RATE = 30; // Hz — smoother viewer updates
export const VIEWER_BROADCAST_INTERVAL = Math.floor(TICK_RATE / VIEWER_BROADCAST_RATE);

// ── Agent HTTP API ──
/** If an agent hasn't polled GET /api/game-state for this long, forfeit them */
export const AGENT_INACTIVITY_TIMEOUT_MS = 10_000; // 10 seconds
