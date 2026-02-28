import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";

/**
 * Heuristic Agent — "The Tactician"
 *
 * Strategy: Defensive fighter that controls the center of the arena.
 * - Stays near center, shoots from range
 * - Dodges incoming projectiles with lateral movement
 * - Charges for melee ring-out when opponent is near edge
 * - Uses windmill arms at close range
 */
export function heuristicAgent(
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

  // ── Calculate spatial info ──
  const dx = opponent.chassis.position.x - me.chassis.position.x;
  const dz = opponent.chassis.position.z - me.chassis.position.z;
  const distToOpponent = Math.hypot(dx, dz);

  const myDistFromCenter = Math.hypot(me.chassis.position.x, me.chassis.position.z);
  const oppDistFromCenter = Math.hypot(opponent.chassis.position.x, opponent.chassis.position.z);

  // ── Facing direction from quaternion ──
  const rot = me.chassis.rotation;
  const fw_x = 2 * (rot.x * rot.z + rot.w * rot.y);
  const fw_z = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
  const myFacing = Math.atan2(fw_x, fw_z);

  // Direction to opponent
  const dirToOpponent = Math.atan2(dx, dz);
  let angleDiff = dirToOpponent - myFacing;
  while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
  while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

  // Direction to center
  const dxCenter = -me.chassis.position.x;
  const dzCenter = -me.chassis.position.z;
  const dirToCenter = Math.atan2(dxCenter, dzCenter);
  let angleToCenterDiff = dirToCenter - myFacing;
  while (angleToCenterDiff > Math.PI) angleToCenterDiff -= 2 * Math.PI;
  while (angleToCenterDiff < -Math.PI) angleToCenterDiff += 2 * Math.PI;

  // ── Check for incoming projectiles ──
  const incomingCount = (state.projectiles ?? []).filter(
    (p) => p.ownerId !== agentId
  ).length;

  // ── Decide mode ──
  let driveForce = 0;
  let turnRate = 0;
  let shoot = false;
  let leftArm = 0;
  let rightArm = 0;
  let mode = "idle";

  const t = state.tick;

  if (distToOpponent < 3) {
    // CLOSE RANGE: windmill attack + drive into opponent to push them out
    mode = "melee";
    turnRate = Math.max(-1, Math.min(1, angleDiff * 3));
    driveForce = 0.8; // push them!
    const leftSwing = Math.sin(t * 0.15 * Math.PI * 2);
    const rightSwing = Math.sin(t * 0.15 * Math.PI * 2 + Math.PI);
    leftArm = leftSwing;
    rightArm = rightSwing;
    shoot = Math.abs(angleDiff) < 0.4; // point blank shots
  } else if (incomingCount > 0) {
    // DODGE: strafe perpendicular to incoming projectile direction
    mode = "dodging";
    // Turn to face opponent but strafe sideways
    turnRate = Math.max(-1, Math.min(1, angleDiff * 2));
    // Dodge by driving perpendicular — alternate direction
    driveForce = 0.6;
    // Add lateral evasion by alternating turn direction
    turnRate += (t % 30 < 15) ? 0.5 : -0.5;
    turnRate = Math.max(-1, Math.min(1, turnRate));
    leftArm = -0.5;
    rightArm = -0.5;
  } else if (oppDistFromCenter > 7 && distToOpponent < 8) {
    // OPPORTUNITY: opponent near edge — charge for ring-out!
    mode = "charging";
    turnRate = Math.max(-1, Math.min(1, angleDiff * 3));
    driveForce = 1.0;
    leftArm = 0.8;
    rightArm = 0.8;
    shoot = Math.abs(angleDiff) < 0.3;
  } else if (myDistFromCenter > 5) {
    // TOO FAR FROM CENTER: return to center
    mode = "returning";
    turnRate = Math.max(-1, Math.min(1, angleToCenterDiff * 3));
    driveForce = 0.7;
    leftArm = -0.3;
    rightArm = -0.3;
  } else {
    // RANGED: stay in center, face opponent, shoot from distance
    mode = "ranged";
    turnRate = Math.max(-1, Math.min(1, angleDiff * 2.5));

    // Maintain optimal range (5-7m)
    if (distToOpponent < 5) {
      driveForce = -0.4; // back up
    } else if (distToOpponent > 8) {
      driveForce = 0.3; // close a bit
    } else {
      driveForce = 0; // good range, hold position
    }

    // Shoot when aligned
    shoot = Math.abs(angleDiff) < 0.25;

    // Arms in guard position
    const windUp = Math.sin(t * 0.08 * Math.PI * 2);
    leftArm = windUp > 0 ? 0.6 : -0.3;
    rightArm = windUp > 0 ? 0.6 : -0.3;
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
    const dist = context.tactical.distanceToOpponent;
    const cd = context.tactical.myCooldownS;
    if (mode === "melee") {
      action.thought = "FEEL MY FISTS!";
      action.privateThought = `Melee brawl at ${dist.toFixed(1)}m`;
    } else if (mode === "dodging") {
      action.thought = "Nice try!";
      action.privateThought = `Dodging ${incomingCount} projectile(s)`;
    } else if (mode === "charging") {
      action.thought = "You're too close to the edge!";
      action.privateThought = `Opponent at ${oppDistFromCenter.toFixed(1)}m from center — charging for ring-out`;
    } else if (mode === "returning") {
      action.thought = "Repositioning...";
      action.privateThought = `Too far from center (${myDistFromCenter.toFixed(1)}m), returning`;
    } else {
      action.thought = cd > 0 ? "Reloading..." : "Take this!";
      action.privateThought = `Ranged mode: dist=${dist.toFixed(1)}m, cooldown=${cd.toFixed(1)}s, aligned=${Math.abs(angleDiff) < 0.25}`;
    }
  }

  return action;
}
