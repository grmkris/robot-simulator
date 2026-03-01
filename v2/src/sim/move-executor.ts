/**
 * Move Executor — translates discrete Move enums into per-tick AgentAction physics commands.
 *
 * Each move maps to velocity/motor targets that play out over TICKS_PER_STEP physics ticks.
 * All movement moves auto-face the opponent for intuitive control.
 */

import type { AgentAction, AgentId, WorldState } from "../shared/types.js";
import { Move } from "../shared/types.js";
import type { RobotConfig } from "../shared/builds.js";
import {
  MOVE_ADVANCE_DISTANCE,
  MOVE_RETREAT_DISTANCE,
  MOVE_CHARGE_DISTANCE,
  MOVE_CHARGE_ARM_TARGET,
  MOVE_PUNCH_ARM_TARGET,
  CHASSIS_MOVE_MULTIPLIER,
  TICK_RATE,
} from "../shared/constants.js";

// ── Angle math (same as tactical.ts) ──

function getFacingAngle(rot: { x: number; y: number; z: number; w: number }): number {
  const fw_x = 2 * (rot.x * rot.z + rot.w * rot.y);
  const fw_z = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
  return Math.atan2(fw_x, fw_z);
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Compute a normalized driveForce [0,1] that achieves approximately
 * `targetDistance` meters over `ticks` physics ticks, given the robot's maxSpeed.
 */
function computeDriveStrength(
  targetDistance: number,
  ticks: number,
  config: RobotConfig,
): number {
  const timeS = ticks / TICK_RATE;
  const desiredSpeed = targetDistance / timeS;
  return Math.min(1, desiredSpeed / config.maxSpeed);
}

/**
 * Compute the turnRate needed to face the opponent.
 * Returns a clamped [-1, 1] value.
 */
function computeTurnToFace(
  myRot: { x: number; y: number; z: number; w: number },
  myPos: { x: number; y: number; z: number },
  oppPos: { x: number; y: number; z: number },
): number {
  const dx = oppPos.x - myPos.x;
  const dz = oppPos.z - myPos.z;
  const dirToOpp = Math.atan2(dx, dz);
  const myFacing = getFacingAngle(myRot);
  const angleToOpp = normalizeAngle(dirToOpp - myFacing);
  return Math.max(-1, Math.min(1, angleToOpp * 3));
}

/**
 * Convert a Move enum into the AgentAction to apply on a given tick.
 *
 * Moves are relative to the opponent's position:
 * - ADVANCE = drive toward opponent
 * - RETREAT = drive away from opponent
 * - CIRCLE = strafe perpendicular
 */
export function computeActionForMove(
  move: Move,
  agentId: AgentId,
  config: RobotConfig,
  state: WorldState,
  tickInStep: number,
  totalTicksInStep: number,
): AgentAction {
  const me = state.robots[agentId];
  const opponentId: AgentId = agentId === 0 ? 1 : 0;
  const opp = state.robots[opponentId];

  const turnToFace = computeTurnToFace(
    me.chassis.rotation,
    me.chassis.position,
    opp.chassis.position,
  );

  const mult = CHASSIS_MOVE_MULTIPLIER[config.build.chassis];

  switch (move) {
    case Move.ADVANCE: {
      const drive = computeDriveStrength(
        MOVE_ADVANCE_DISTANCE * mult,
        totalTicksInStep,
        config,
      );
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: drive,
        turnRate: turnToFace,
      };
    }

    case Move.RETREAT: {
      const drive = computeDriveStrength(
        MOVE_RETREAT_DISTANCE * mult,
        totalTicksInStep,
        config,
      );
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: -drive,
        turnRate: turnToFace,
      };
    }

    case Move.CIRCLE_LEFT: {
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: 0.3 * mult,
        turnRate: Math.max(-1, turnToFace + 0.6),
      };
    }

    case Move.CIRCLE_RIGHT: {
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: 0.3 * mult,
        turnRate: Math.min(1, turnToFace - 0.6),
      };
    }

    case Move.CHARGE: {
      const drive = computeDriveStrength(
        MOVE_CHARGE_DISTANCE * mult,
        totalTicksInStep,
        config,
      );
      return {
        leftArmTarget: MOVE_CHARGE_ARM_TARGET,
        rightArmTarget: MOVE_CHARGE_ARM_TARGET,
        driveForce: Math.min(1, drive * 1.5),
        turnRate: turnToFace,
      };
    }

    case Move.PUNCH_LEFT: {
      const swingProgress = tickInStep / totalTicksInStep;
      const armTarget = swingProgress < 0.3 ? -1 : MOVE_PUNCH_ARM_TARGET;
      return {
        leftArmTarget: armTarget,
        rightArmTarget: -0.3,
        driveForce: 0.2,
        turnRate: turnToFace,
      };
    }

    case Move.PUNCH_RIGHT: {
      const swingProgress = tickInStep / totalTicksInStep;
      const armTarget = swingProgress < 0.3 ? -1 : MOVE_PUNCH_ARM_TARGET;
      return {
        leftArmTarget: -0.3,
        rightArmTarget: armTarget,
        driveForce: 0.2,
        turnRate: turnToFace,
      };
    }

    case Move.SHOOT: {
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: 0,
        turnRate: turnToFace,
        shoot: tickInStep === 0,
      };
    }

    case Move.GUARD: {
      return {
        leftArmTarget: 0.5,
        rightArmTarget: 0.5,
        driveForce: 0,
        turnRate: turnToFace,
      };
    }

    case Move.DODGE_LEFT: {
      const isDashing = tickInStep < totalTicksInStep * 0.4;
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: isDashing ? 0.5 * mult : 0,
        turnRate: isDashing ? -1 : turnToFace,
      };
    }

    case Move.DODGE_RIGHT: {
      const isDashing = tickInStep < totalTicksInStep * 0.4;
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: isDashing ? 0.5 * mult : 0,
        turnRate: isDashing ? 1 : turnToFace,
      };
    }

    default:
      return { leftArmTarget: 0, rightArmTarget: 0, driveForce: 0, turnRate: 0 };
  }
}
