// ── Physics ──
export const TICK_RATE = 60;
export const TICK_DURATION_S = 1 / TICK_RATE;
export const TICK_DURATION_MS = 1000 / TICK_RATE;

// ── Arena ──
export const ARENA_RADIUS = 10; // Bigger arena for maneuvering (was 5)
export const ARENA_FLOOR_Y = 0;

// ── Robot Chassis ──
export const CHASSIS_HALF_EXTENTS = { x: 0.5, y: 0.3, z: 0.5 } as const;
export const CHASSIS_MASS = 12; // kg — heavier = harder to knock off (need multiple hits)

// ── Robot Arms ──
export const ARM_HALF_EXTENTS = { x: 0.12, y: 0.12, z: 0.7 } as const;
export const ARM_MASS = 1.5; // kg
export const ARM_ANGLE_MIN = -Math.PI / 2.5; // -72 degrees
export const ARM_ANGLE_MAX = Math.PI / 2.5; // +72 degrees
export const ARM_MOTOR_STIFFNESS = 40; // Nm/rad — reduced to prevent collision catapult
export const ARM_MOTOR_DAMPING = 8; // Nm*s/rad — higher damping for stability

// ── Chassis Drive (agent-controlled, no more auto-approach) ──
export const CHASSIS_DRIVE_FORCE = 40; // Newtons — agent-controlled thrust (40/12kg ≈ 3.3 m/s²)
export const CHASSIS_MAX_SPEED = 4; // m/s — moderate top speed
export const CHASSIS_TURN_TORQUE = 15; // Nm — yaw turning power
export const CHASSIS_MAX_ANGULAR_SPEED = 3; // rad/s — cap on yaw rotation

// ── Projectile ──
export const PROJECTILE_SPEED = 10; // m/s
export const PROJECTILE_COOLDOWN_MS = 3000; // 3 seconds between shots
export const PROJECTILE_COOLDOWN_TICKS = Math.ceil(PROJECTILE_COOLDOWN_MS / TICK_DURATION_MS);
export const PROJECTILE_KNOCKBACK_IMPULSE = 30; // N*s — shove (30/12kg = 2.5 m/s per hit)
export const PROJECTILE_LIFETIME_MS = 2000; // disappears after 2 seconds
export const PROJECTILE_LIFETIME_TICKS = Math.ceil(PROJECTILE_LIFETIME_MS / TICK_DURATION_MS);
export const PROJECTILE_RADIUS = 0.15; // collision sphere radius

// ── Match Rules ──
export const MATCH_DURATION_S = 60; // Longer matches for bigger arena (was 45)
export const MATCH_DURATION_TICKS = MATCH_DURATION_S * TICK_RATE;
export const RING_OUT_Y_THRESHOLD = -2;
export const RING_OUT_DISTANCE_MARGIN = 1; // beyond arena radius

// ── Turn-based (3-Step Programs) ──
export const TICKS_PER_STEP = 20; // ~333ms game time per step
export const STEPS_PER_TURN = 3; // 3 steps per program
export const TICKS_PER_TURN = TICKS_PER_STEP * STEPS_PER_TURN; // 60 ticks per turn (~1s game time)
export const TURN_TIMEOUT_MS = 30_000; // 30s per-turn timeout

// ── Move Physics ──
export const MOVE_ADVANCE_DISTANCE = 2.0; // meters toward opponent
export const MOVE_RETREAT_DISTANCE = 2.0; // meters away from opponent
export const MOVE_CIRCLE_DISTANCE = 1.5; // meters lateral strafe
export const MOVE_CHARGE_DISTANCE = 3.0; // meters toward opponent (risky rush)
export const MOVE_DODGE_DISTANCE = 2.0; // meters quick sidestep
export const PUNCH_HIT_RANGE = 2.0; // meters — punch only hits within this range
export const MOVE_GUARD_KNOCKBACK_REDUCTION = 0.5; // 50% knockback when guarding
export const MOVE_CHARGE_ARM_TARGET = 0.8; // arms partially forward during charge
export const MOVE_PUNCH_ARM_TARGET = 1.0; // full arm swing forward

// ── Chassis Move Multipliers ──
export const CHASSIS_MOVE_MULTIPLIER = {
  light: 1.5,
  medium: 1.0,
  heavy: 0.6,
} as const;

// ── Protocol ──
export const PROTOCOL_VERSION = 6;
export const MAX_AGENTS = 2;
export const VIEWER_BROADCAST_RATE = 30; // Hz
export const VIEWER_BROADCAST_INTERVAL = Math.floor(TICK_RATE / VIEWER_BROADCAST_RATE);

// ── Countdown ──
export const COUNTDOWN_DURATION_S = 5;
export const COUNTDOWN_DURATION_TICKS = COUNTDOWN_DURATION_S * TICK_RATE;

// ── Queue ──
export const MAX_QUEUE_SIZE = 10;
export const QUEUE_INACTIVITY_TIMEOUT_MS = 60_000; // 60 seconds

// ── Agent HTTP API ──
export const AGENT_INACTIVITY_TIMEOUT_MS = 10_000; // 10 seconds
