import { z } from "zod";
import { Action, Direction, PickupKind, TileType } from "./types.js";

// ═══════════════════════════════════════════════
// GridRoyale — Zod Schemas
// ═══════════════════════════════════════════════

// ── Enums ──

export const DirectionSchema = z.nativeEnum(Direction);
export const ActionSchema = z.nativeEnum(Action);
export const PickupKindSchema = z.nativeEnum(PickupKind);
export const TileTypeSchema = z.nativeEnum(TileType);
export const GamePhaseSchema = z.enum(["lobby", "countdown", "active", "finished"]);

// ── Intent ──

export const IntentSchema = z.object({
  action: ActionSchema,
  dir: DirectionSchema.optional(),
}).refine(
  (val) => {
    // MOVE, DASH, SHOOT require direction
    if (val.action === Action.MOVE || val.action === Action.DASH || val.action === Action.SHOOT) {
      return val.dir !== undefined;
    }
    return true;
  },
  { message: "MOVE, DASH, and SHOOT require a direction (dir)" },
);

// ── API Requests ──

export const QueueRequestSchema = z.object({
  name: z.string().min(1).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Name must be alphanumeric with _ or -"),
  mode: z.literal("br_grid_v1").optional().default("br_grid_v1"),
});

export const ActRequestSchema = z.object({
  matchId: z.string().min(1),
  action: z.object({
    t: ActionSchema,
    dir: DirectionSchema.optional(),
  }),
  applyTick: z.number().int().positive().optional(),
});

export const StepRequestSchema = z.object({
  matchId: z.string().optional(),
  action: z.object({
    t: ActionSchema,
    dir: DirectionSchema.optional(),
  }).optional(),
});

export const LeaveRequestSchema = z.object({
  matchId: z.string().optional(),
});

// ── Observation Schema (for validation/documentation) ──

export const CooldownsSchema = z.object({
  shoot: z.number().int().min(0),
  dash: z.number().int().min(0),
  pickup: z.number().int().min(0),
});

export const SelfSchema = z.object({
  id: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number().int(),
  shield: z.number().int(),
  stamina: z.number().int(),
  ammo: z.number().int(),
  facing: DirectionSchema,
  cooldowns: CooldownsSchema,
});

export const ZoneSchema = z.object({
  cx: z.number().int(),
  cy: z.number().int(),
  r: z.number().int(),
});

export const VisibleEnemySchema = z.object({
  id: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number().int(),
  shield: z.number().int(),
});

export const VisiblePickupSchema = z.object({
  id: z.number().int(),
  kind: PickupKindSchema,
  x: z.number().int(),
  y: z.number().int(),
});

export const VisibleProjectileSchema = z.object({
  id: z.number().int(),
  x: z.number().int(),
  y: z.number().int(),
  dir: DirectionSchema,
  own: z.boolean(),
});

export const VisibleTileSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  t: TileTypeSchema,
});

export const GameEventSchema = z.object({
  tick: z.number().int(),
  type: z.enum(["DAMAGE", "KILL", "PICKUP", "ZONE_SHRINK", "SHOT", "DASH"]),
  data: z.record(z.unknown()),
});

export const ActionResultSchema = z.object({
  action: ActionSchema,
  dir: DirectionSchema.optional(),
  success: z.boolean(),
  reason: z.string().optional(),
});

export const ObservationSchema = z.object({
  matchId: z.string(),
  tick: z.number().int(),
  decisionIndex: z.number().int(),
  self: SelfSchema,
  zone: ZoneSchema,
  visible: z.object({
    tiles: z.array(VisibleTileSchema),
    enemies: z.array(VisibleEnemySchema),
    pickups: z.array(VisiblePickupSchema),
    projectiles: z.array(VisibleProjectileSchema),
  }),
  recentEvents: z.array(GameEventSchema),
  playersAlive: z.number().int(),
  lastAction: ActionResultSchema.optional(),
});
