import RAPIER from "@dimforge/rapier3d-compat";
import type { AgentId, AgentAction } from "@ai-arena/protocol";
import {
  CHASSIS_HALF_EXTENTS,
  ARM_HALF_EXTENTS,
  CHASSIS_MASS,
  ARM_MASS,
  ARM_ANGLE_MIN,
  ARM_ANGLE_MAX,
  ARM_MOTOR_STIFFNESS,
  ARM_MOTOR_DAMPING,
} from "@ai-arena/protocol";

/** A fully-constructed robot with physics bodies and joints */
export interface Robot {
  id: AgentId;
  chassis: RAPIER.RigidBody;
  leftArm: RAPIER.RigidBody;
  rightArm: RAPIER.RigidBody;
  leftJoint: RAPIER.ImpulseJoint;
  rightJoint: RAPIER.ImpulseJoint;
}

/**
 * Factory for constructing robots in the physics world.
 * Each robot: 1 chassis (cuboid) + 2 arms (cuboid) connected by revolute joints.
 */
export class RobotFactory {
  constructor(private world: RAPIER.World) {}

  create(id: AgentId, spawnX: number, spawnZ: number): Robot {
    const spawnY = CHASSIS_HALF_EXTENTS.y + 0.05;

    // ── Chassis ──
    const chassisDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnX, spawnY, spawnZ);
    const chassis = this.world.createRigidBody(chassisDesc);

    const chassisVol =
      8 *
      CHASSIS_HALF_EXTENTS.x *
      CHASSIS_HALF_EXTENTS.y *
      CHASSIS_HALF_EXTENTS.z;
    const chassisCollider = RAPIER.ColliderDesc.cuboid(
      CHASSIS_HALF_EXTENTS.x,
      CHASSIS_HALF_EXTENTS.y,
      CHASSIS_HALF_EXTENTS.z
    )
      .setDensity(CHASSIS_MASS / chassisVol)
      .setFriction(0.8)
      .setRestitution(0.3); // Some bounce on collision for drama
    this.world.createCollider(chassisCollider, chassis);

    // Moderate damping — fast movement, controlled spinning
    chassis.setLinearDamping(1.0);
    chassis.setAngularDamping(2.0);

    // ── Left Arm ──
    const leftArmX = spawnX - CHASSIS_HALF_EXTENTS.x - ARM_HALF_EXTENTS.x;
    const leftArm = this.createArmBody(leftArmX, spawnY, spawnZ);

    // ── Right Arm ──
    const rightArmX = spawnX + CHASSIS_HALF_EXTENTS.x + ARM_HALF_EXTENTS.x;
    const rightArm = this.createArmBody(rightArmX, spawnY, spawnZ);

    // ── Revolute Joints (rotate around Y axis) ──
    const leftJointData = RAPIER.JointData.revolute(
      // Anchor on chassis: left edge
      new RAPIER.Vector3(-CHASSIS_HALF_EXTENTS.x, 0, 0),
      // Anchor on arm: right edge (attached end)
      new RAPIER.Vector3(ARM_HALF_EXTENTS.x, 0, 0),
      // Rotation axis: Y-up
      new RAPIER.Vector3(0, 1, 0)
    );
    leftJointData.limitsEnabled = true;
    leftJointData.limits = [ARM_ANGLE_MIN, ARM_ANGLE_MAX];
    const leftJoint = this.world.createImpulseJoint(
      leftJointData,
      chassis,
      leftArm,
      true
    );

    const rightJointData = RAPIER.JointData.revolute(
      // Anchor on chassis: right edge
      new RAPIER.Vector3(CHASSIS_HALF_EXTENTS.x, 0, 0),
      // Anchor on arm: left edge (attached end)
      new RAPIER.Vector3(-ARM_HALF_EXTENTS.x, 0, 0),
      // Rotation axis: Y-up
      new RAPIER.Vector3(0, 1, 0)
    );
    rightJointData.limitsEnabled = true;
    rightJointData.limits = [ARM_ANGLE_MIN, ARM_ANGLE_MAX];
    const rightJoint = this.world.createImpulseJoint(
      rightJointData,
      chassis,
      rightArm,
      true
    );

    return { id, chassis, leftArm, rightArm, leftJoint, rightJoint };
  }

  private createArmBody(
    x: number,
    y: number,
    z: number
  ): RAPIER.RigidBody {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
    const body = this.world.createRigidBody(desc);

    const armVol =
      8 * ARM_HALF_EXTENTS.x * ARM_HALF_EXTENTS.y * ARM_HALF_EXTENTS.z;
    const collider = RAPIER.ColliderDesc.cuboid(
      ARM_HALF_EXTENTS.x,
      ARM_HALF_EXTENTS.y,
      ARM_HALF_EXTENTS.z
    )
      .setDensity(ARM_MASS / armVol)
      .setFriction(0.6)
      .setRestitution(0.4); // Arms bounce off on impact
    this.world.createCollider(collider, body);

    return body;
  }
}

/**
 * Apply an agent's action to a robot's joint motors.
 * Maps normalized [-1, 1] inputs to the joint's angle range.
 */
export function applyAction(robot: Robot, action: AgentAction): void {
  const leftTarget = mapNormalizedToAngle(action.leftArmTarget);
  const rightTarget = mapNormalizedToAngle(action.rightArmTarget);

  // Position-based motor: spring-damper drives to target angle
  (robot.leftJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(
    leftTarget,
    ARM_MOTOR_STIFFNESS,
    ARM_MOTOR_DAMPING
  );
  (robot.rightJoint as RAPIER.RevoluteImpulseJoint).configureMotorPosition(
    rightTarget,
    ARM_MOTOR_STIFFNESS,
    ARM_MOTOR_DAMPING
  );
}

/** Map [-1, 1] normalized value to [ARM_ANGLE_MIN, ARM_ANGLE_MAX] radians */
function mapNormalizedToAngle(normalized: number): number {
  const clamped = Math.max(-1, Math.min(1, normalized));
  // Linearly interpolate between min and max
  return ((clamped + 1) / 2) * (ARM_ANGLE_MAX - ARM_ANGLE_MIN) + ARM_ANGLE_MIN;
}
