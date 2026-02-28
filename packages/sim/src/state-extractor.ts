import type RAPIER from "@dimforge/rapier3d-compat";
import type { Robot } from "./robot-factory.js";
import type {
  RobotState,
  BodyState,
  ArmState,
  WorldState,
  MatchPhase,
  AgentAction,
} from "@ai-arena/protocol";
import { TICK_DURATION_S, RING_OUT_Y_THRESHOLD } from "@ai-arena/protocol";

/** Extract serializable body state from a Rapier rigid body */
export function extractBodyState(body: RAPIER.RigidBody): BodyState {
  const pos = body.translation();
  const rot = body.rotation();
  const lv = body.linvel();
  const av = body.angvel();
  return {
    position: { x: pos.x, y: pos.y, z: pos.z },
    rotation: { x: rot.x, y: rot.y, z: rot.z, w: rot.w },
    linvel: { x: lv.x, y: lv.y, z: lv.z },
    angvel: { x: av.x, y: av.y, z: av.z },
  };
}

/**
 * Compute the relative Y-axis rotation angle between two rigid bodies.
 * Used to derive the revolute joint angle since Rapier compat doesn't expose .angle().
 */
function computeRelativeYAngle(
  parentBody: RAPIER.RigidBody,
  childBody: RAPIER.RigidBody
): number {
  const pRot = parentBody.rotation();
  const cRot = childBody.rotation();

  // Extract yaw (Y-axis rotation) from each quaternion
  // yaw = atan2(2*(w*y + x*z), 1 - 2*(y*y + z*z)) — simplified for Y-axis
  const pYaw = Math.atan2(
    2 * (pRot.w * pRot.y + pRot.x * pRot.z),
    1 - 2 * (pRot.y * pRot.y + pRot.z * pRot.z)
  );
  const cYaw = Math.atan2(
    2 * (cRot.w * cRot.y + cRot.x * cRot.z),
    1 - 2 * (cRot.y * cRot.y + cRot.z * cRot.z)
  );

  // Relative angle
  let angle = cYaw - pYaw;

  // Normalize to [-PI, PI]
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;

  return angle;
}

/** Extract arm state including joint angle */
export function extractArmState(
  armBody: RAPIER.RigidBody,
  chassisBody: RAPIER.RigidBody,
  _joint: RAPIER.ImpulseJoint,
  targetNormalized: number
): ArmState {
  return {
    body: extractBodyState(armBody),
    currentAngle: computeRelativeYAngle(chassisBody, armBody),
    targetAngle: targetNormalized,
  };
}

/** Extract complete robot state */
export function extractRobotState(
  robot: Robot,
  lastAction: AgentAction
): RobotState {
  const chassisPos = robot.chassis.translation();
  return {
    id: robot.id,
    chassis: extractBodyState(robot.chassis),
    leftArm: extractArmState(
      robot.leftArm,
      robot.chassis,
      robot.leftJoint,
      lastAction.leftArmTarget
    ),
    rightArm: extractArmState(
      robot.rightArm,
      robot.chassis,
      robot.rightJoint,
      lastAction.rightArmTarget
    ),
    isAlive: chassisPos.y > RING_OUT_Y_THRESHOLD,
  };
}

/** Extract full world state for a given tick */
export function extractWorldState(
  tick: number,
  robots: [Robot, Robot],
  actions: [AgentAction, AgentAction],
  matchPhase: MatchPhase
): WorldState {
  return {
    tick,
    elapsed: tick * TICK_DURATION_S,
    robots: [
      extractRobotState(robots[0], actions[0]),
      extractRobotState(robots[1], actions[1]),
    ],
    matchPhase,
  };
}
