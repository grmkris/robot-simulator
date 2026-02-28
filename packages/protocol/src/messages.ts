import { z } from "zod";
import {
  AgentActionSchema,
  AgentIdSchema,
  RobotStateSchema,
  MatchPhaseSchema,
} from "./schemas.js";

// ═══════════════════════════════════════════════
// Server → Agent Messages
// ═══════════════════════════════════════════════

export const WelcomeMessageSchema = z.object({
  type: z.literal("welcome"),
  protocolVersion: z.number().int(),
  agentId: AgentIdSchema,
  arenaRadius: z.number(),
  tickRate: z.number(),
});

export const TickMessageSchema = z.object({
  type: z.literal("tick"),
  tick: z.number().int(),
  you: AgentIdSchema,
  robots: z.tuple([RobotStateSchema, RobotStateSchema]),
  matchPhase: MatchPhaseSchema,
});

export const MatchEndMessageSchema = z.object({
  type: z.literal("match_end"),
  winner: AgentIdSchema.nullable(),
  reason: z.enum(["ring_out", "timeout", "disconnect"]),
});

export const ErrorMessageSchema = z.object({
  type: z.literal("error"),
  message: z.string(),
});

// ═══════════════════════════════════════════════
// Agent → Server Messages
// ═══════════════════════════════════════════════

export const JoinMessageSchema = z.object({
  type: z.literal("join"),
  name: z.string().min(1).max(32),
});

export const ActionMessageSchema = z.object({
  type: z.literal("action"),
  tick: z.number().int(),
  action: AgentActionSchema,
});

// ═══════════════════════════════════════════════
// Discriminated Unions
// ═══════════════════════════════════════════════

export const ServerMessageSchema = z.discriminatedUnion("type", [
  WelcomeMessageSchema,
  TickMessageSchema,
  MatchEndMessageSchema,
  ErrorMessageSchema,
]);

export const ClientMessageSchema = z.discriminatedUnion("type", [
  JoinMessageSchema,
  ActionMessageSchema,
]);

// ═══════════════════════════════════════════════
// Inferred Types
// ═══════════════════════════════════════════════

export type ServerMessage = z.infer<typeof ServerMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type WelcomeMessage = z.infer<typeof WelcomeMessageSchema>;
export type TickMessage = z.infer<typeof TickMessageSchema>;
export type MatchEndMessage = z.infer<typeof MatchEndMessageSchema>;
export type ErrorMessage = z.infer<typeof ErrorMessageSchema>;
export type JoinMessage = z.infer<typeof JoinMessageSchema>;
export type ActionMessage = z.infer<typeof ActionMessageSchema>;
