import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";

/**
 * Heuristic agent: faces the opponent and swings arms toward them.
 * Simple but effective against random opponents.
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

  // Angle to opponent (relative to forward direction)
  const angleToOpponent = Math.atan2(dx, dz);

  // Normalize to [-1, 1] range
  const normalized = Math.max(-1, Math.min(1, angleToOpponent / Math.PI));

  // Swing both arms toward the opponent
  return {
    leftArmTarget: normalized,
    rightArmTarget: normalized,
  };
}
