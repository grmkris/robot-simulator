import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";

/**
 * Aggressive Heuristic Agent — "The Brawler"
 *
 * Strategy:
 * 1. Rapidly alternates arms for a windmill punching attack
 * 2. When close to opponent, does alternating power slams
 * 3. When near the edge, pulls arms back defensively
 * 4. Uses sinusoidal oscillation for unpredictable arm movement
 */
export function heuristicAgent(
  agentId: AgentId,
  state: WorldState
): AgentAction {
  const me = state.robots[agentId];
  const opponentIdx = agentId === 0 ? 1 : 0;
  const opponent = state.robots[opponentIdx];

  if (!me || !opponent) {
    return { leftArmTarget: 0, rightArmTarget: 0 };
  }

  // Vector from me to opponent
  const dx = opponent.chassis.position.x - me.chassis.position.x;
  const dz = opponent.chassis.position.z - me.chassis.position.z;
  const distToOpponent = Math.hypot(dx, dz);

  // How close am I to the arena edge?
  const myDistFromCenter = Math.hypot(
    me.chassis.position.x,
    me.chassis.position.z
  );

  // Time-based oscillation for windmill punching
  const t = state.tick;

  // ── Close range: alternating power punches ──
  if (distToOpponent < 3) {
    // Rapid alternating slams — left and right out of phase
    const leftSwing = Math.sin(t * 0.15 * Math.PI * 2);
    const rightSwing = Math.sin(t * 0.15 * Math.PI * 2 + Math.PI);

    return {
      leftArmTarget: leftSwing,
      rightArmTarget: rightSwing,
    };
  }

  // ── Near edge: defensive — pull arms back ──
  if (myDistFromCenter > 3.5) {
    return {
      leftArmTarget: -0.8,
      rightArmTarget: -0.8,
    };
  }

  // ── Mid range: wind up for a big hit ──
  const windUp = Math.sin(t * 0.08 * Math.PI * 2);
  return {
    leftArmTarget: windUp > 0 ? 1 : -0.5,
    rightArmTarget: windUp > 0 ? 1 : -0.5,
  };
}
