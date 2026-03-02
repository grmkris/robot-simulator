// ═══════════════════════════════════════════════
// GridRoyale — Game Constants
// ═══════════════════════════════════════════════

// ── Grid ──
export const GRID_W = 40;
export const GRID_H = 40;

// ── Tick Rates ──
export const SIM_TPS = 10; // simulation ticks per second
export const SIM_TICK_MS = 1000 / SIM_TPS; // 100ms per tick
export const DECISION_TPS = 2; // decision windows per second
export const DECISION_INTERVAL = SIM_TPS / DECISION_TPS; // 5 ticks between decisions

// ── Action Scheduling ──
export const LEAD_TICKS = 3; // default lead time for intents
export const MIN_APPLY_OFFSET = 2; // earliest applyTick relative to current
export const MAX_APPLY_OFFSET = 30; // latest applyTick relative to current

// ── Player Base Stats ──
export const INITIAL_HP = 100;
export const INITIAL_SHIELD = 0;
export const INITIAL_STAMINA = 100;
export const INITIAL_AMMO = 12;
export const MAX_HP = 100;
export const MAX_SHIELD = 50;
export const MAX_STAMINA = 100;
export const MAX_AMMO = 12;

// ── Cooldowns (in ticks) ──
export const SHOOT_COOLDOWN = 2;
export const DASH_COOLDOWN = 8;
export const PICKUP_COOLDOWN = 2;

// ── Dash ──
export const DASH_STAMINA_COST = 30;
export const DASH_DISTANCE = 2; // tiles

// ── Projectile ──
export const PROJECTILE_SPEED = 1; // tiles per tick
export const PROJECTILE_TTL = 20; // ticks
export const PROJECTILE_DAMAGE = 12;

// ── Fog of War ──
export const VISION_RADIUS = 8; // Chebyshev distance (square)
export const VISION_SIZE = VISION_RADIUS * 2 + 1; // 17x17 visible window

// ── Pickups ──
export const PICKUP_MEDKIT_HP = 25;
export const PICKUP_SHIELD_AMOUNT = 15;
export const PICKUP_AMMO_AMOUNT = 6;
export const PICKUP_STAMINA_AMOUNT = 30;
export const PICKUP_RESPAWN_INTERVAL = 100; // ticks (~10s)

// ── Zone (Battle Royale) ──
export const ZONE_SHRINK_INTERVAL = 50; // ticks between shrinks (5 seconds)
export const ZONE_DAMAGE_PER_TICK = 2;

// ── Game Rules ──
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 16;
export const LOBBY_COUNTDOWN_S = 10;
export const LOBBY_COUNTDOWN_TICKS = LOBBY_COUNTDOWN_S * SIM_TPS;
export const DECISION_TIMEOUT_MS = 5000; // 5s to submit intent (for br.step waiters)
export const DECISION_WAIT_TIMEOUT_MS = 30_000; // 30s max wait per turn-based decision

// ── Stamina Regen ──
export const STAMINA_REGEN_PER_TICK = 2;

// ── Viewer ──
export const VIEWER_FPS = 10;
export const VIEWER_TICK_INTERVAL = Math.max(1, Math.floor(SIM_TPS / VIEWER_FPS));

// ── Protocol ──
export const PROTOCOL_VERSION = 7;

// ── Queue / Lobby ──
export const MAX_QUEUE_SIZE = 20;
export const QUEUE_INACTIVITY_TIMEOUT_MS = 60_000;

// ── Events Payload Limits ──
export const MAX_VISIBLE_TILES = 289; // 17x17
export const MAX_RECENT_EVENTS = 20;
