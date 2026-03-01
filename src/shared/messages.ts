import { z } from "zod";
import { DirectionSchema, GamePhaseSchema, PickupKindSchema } from "./schemas.js";

// ═══════════════════════════════════════════════
// GridRoyale — WebSocket Messages (Viewer)
// ═══════════════════════════════════════════════

// ── Viewer State (full omniscient, sent at VIEWER_FPS) ──

export const ViewerPlayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  hp: z.number().int(),
  shield: z.number().int(),
  stamina: z.number().int(),
  ammo: z.number().int(),
  facing: DirectionSchema,
  alive: z.boolean(),
  kills: z.number().int(),
});

export const ViewerProjectileSchema = z.object({
  id: z.number().int(),
  ownerId: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  dir: DirectionSchema,
});

export const ViewerPickupSchema = z.object({
  id: z.number().int(),
  kind: PickupKindSchema,
  x: z.number().int(),
  y: z.number().int(),
});

export const ViewerZoneSchema = z.object({
  cx: z.number().int(),
  cy: z.number().int(),
  r: z.number().int(),
});

export const ViewerKillEventSchema = z.object({
  tick: z.number().int(),
  killerId: z.string().nullable(),
  victimId: z.string(),
  victimName: z.string(),
  killerName: z.string().nullable(),
  weapon: z.enum(["projectile", "zone"]),
});

// ── Server → Viewer Messages ──

export const ViewerStateMessageSchema = z.object({
  type: z.literal("state"),
  tick: z.number().int(),
  phase: GamePhaseSchema,
  players: z.array(ViewerPlayerSchema),
  projectiles: z.array(ViewerProjectileSchema),
  pickups: z.array(ViewerPickupSchema),
  zone: ViewerZoneSchema,
  killFeed: z.array(ViewerKillEventSchema),
  playersAlive: z.number().int(),
});

export const ViewerLobbyMessageSchema = z.object({
  type: z.literal("lobby"),
  players: z.array(z.object({
    name: z.string(),
    ready: z.boolean(),
  })),
  countdown: z.number().nullable(),
  phase: GamePhaseSchema,
});

export const ViewerGameOverMessageSchema = z.object({
  type: z.literal("game_over"),
  winnerId: z.string().nullable(),
  winnerName: z.string().nullable(),
  reason: z.string(),
  placements: z.array(z.object({
    playerId: z.string(),
    name: z.string(),
    placement: z.number().int(),
    kills: z.number().int(),
  })),
});

export const ViewerMessageSchema = z.discriminatedUnion("type", [
  ViewerStateMessageSchema,
  ViewerLobbyMessageSchema,
  ViewerGameOverMessageSchema,
]);

// ── Inferred Types ──

export type ViewerPlayer = z.infer<typeof ViewerPlayerSchema>;
export type ViewerProjectile = z.infer<typeof ViewerProjectileSchema>;
export type ViewerPickup = z.infer<typeof ViewerPickupSchema>;
export type ViewerZone = z.infer<typeof ViewerZoneSchema>;
export type ViewerKillEvent = z.infer<typeof ViewerKillEventSchema>;
export type ViewerStateMessage = z.infer<typeof ViewerStateMessageSchema>;
export type ViewerLobbyMessage = z.infer<typeof ViewerLobbyMessageSchema>;
export type ViewerGameOverMessage = z.infer<typeof ViewerGameOverMessageSchema>;
export type ViewerMessage = z.infer<typeof ViewerMessageSchema>;
