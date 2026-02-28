import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";

let slamCycle = 0;

/**
 * Aggressive Agent — "The Windmill"
 *
 * Strategy: relentless forward pressure with rapid alternating arm slams.
 * Drives straight at opponent, turns to face them, shoots when aligned.
 * At close range, windmill arms for maximum chaos.
 */
export function aggressiveAgent(
  agentId: AgentId,
  state: WorldState,
  context?: DecisionContext
): AgentAction {
  const me = state.robots[agentId];
  const opponentIdx = agentId === 0 ? 1 : 0;
  const opponent = state.robots[opponentIdx];

  if (!me || !opponent) {
    return { leftArmTarget: 0, rightArmTarget: 0, driveForce: 0, turnRate: 0 };
  }

  slamCycle++;

  const dx = opponent.chassis.position.x - me.chassis.position.x;
  const dz = opponent.chassis.position.z - me.chassis.position.z;
  const dist = Math.hypot(dx, dz);

  // ── Facing & turning logic ──
  // Get my facing direction from quaternion
  const rot = me.chassis.rotation;
  const fw_x = 2 * (rot.x * rot.z + rot.w * rot.y);
  const fw_z = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
  const myFacing = Math.atan2(fw_x, fw_z);

  // Direction to opponent
  const dirToOpponent = Math.atan2(dx, dz);
  let angleDiff = dirToOpponent - myFacing;
  // Normalize to [-PI, PI]
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
  while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

  // ── Edge safety ──
  const myDistFromCenter = Math.hypot(me.chassis.position.x, me.chassis.position.z);

  let turnRate: number;
  let driveForce: number;
  let shoot: boolean;

  if (myDistFromCenter > 7) {
    // Too close to edge! Turn toward center and drive back
    const centerAngle = Math.atan2(-me.chassis.position.x, -me.chassis.position.z);
    let centerDiff = centerAngle - myFacing;
    while (centerDiff > Math.PI) centerDiff -= 2 * Math.PI;
    while (centerDiff < -Math.PI) centerDiff += 2 * Math.PI;
    turnRate = Math.max(-1, Math.min(1, centerDiff * 3));
    driveForce = 0.8; // drive toward center
    shoot = false;
  } else {
    // Turn to face opponent (proportional control)
    turnRate = Math.max(-1, Math.min(1, angleDiff * 2));

    // Drive forward when roughly facing opponent
    const facingAlignment = Math.abs(angleDiff);
    driveForce = facingAlignment < Math.PI / 3 ? 0.8 : 0.3; // charge when roughly facing

    // Shoot when well-aligned with opponent (within ~17 degrees)
    shoot = facingAlignment < 0.3 && dist > 1.5;
  }

  // ── Arm combat ──
  const cyclePhase = slamCycle % 16;
  let leftArm: number;
  let rightArm: number;
  let mode: string;

  if (dist < 2.5) {
    // Close range: rapid alternating full-power slams — "windmill"
    if (cyclePhase < 8) {
      leftArm = 1;
      rightArm = -1;
    } else {
      leftArm = -1;
      rightArm = 1;
    }
    mode = "windmill";
  } else if (dist < 5.0) {
    // Medium range: wide sweeping punches
    const sweep = Math.sin(slamCycle * 0.2 * Math.PI * 2);
    leftArm = sweep;
    rightArm = -sweep;
    mode = "sweeping";
  } else {
    // Approach: arms oscillate menacingly
    const osc = Math.sin(slamCycle * 0.3) * 0.4;
    leftArm = 0.3 + osc;
    rightArm = 0.3 - osc;
    mode = "approaching";
  }

  const action: AgentAction = {
    leftArmTarget: leftArm,
    rightArmTarget: rightArm,
    driveForce,
    turnRate,
    shoot,
  };

  // Add thoughts in Mind Games mode
  if (context) {
    if (mode === "windmill") {
      action.thought = "WINDMILL OF DOOM!!!";
      action.privateThought = `Windmill at ${dist.toFixed(1)}m, angle=${(angleDiff * 180 / Math.PI).toFixed(0)}deg`;
    } else if (mode === "sweeping") {
      action.thought = "You can't dodge forever!";
      action.privateThought = `Sweeping at ${dist.toFixed(1)}m, shooting=${shoot}`;
    } else {
      action.thought = "Here I come...";
      action.privateThought = `Closing: ${dist.toFixed(1)}m, turn=${turnRate.toFixed(2)}`;
    }
  }

  return action;
}
