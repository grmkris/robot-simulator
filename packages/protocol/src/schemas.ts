import { z } from "zod";

// ── Primitives ──

export const Vec3Schema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

export const QuatSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});

export const AgentIdSchema = z.union([z.literal(0), z.literal(1)]);

// ── Agent Action ──

export const AgentActionSchema = z.object({
  leftArmTarget: z.number().min(-1).max(1),
  rightArmTarget: z.number().min(-1).max(1),
});

// ── Body / Arm / Robot State ──

export const BodyStateSchema = z.object({
  position: Vec3Schema,
  rotation: QuatSchema,
  linvel: Vec3Schema,
  angvel: Vec3Schema,
});

export const ArmStateSchema = z.object({
  body: BodyStateSchema,
  currentAngle: z.number(),
  targetAngle: z.number(),
});

export const RobotStateSchema = z.object({
  id: AgentIdSchema,
  chassis: BodyStateSchema,
  leftArm: ArmStateSchema,
  rightArm: ArmStateSchema,
  isAlive: z.boolean(),
});

export const MatchPhaseSchema = z.enum([
  "waiting",
  "countdown",
  "active",
  "finished",
]);
