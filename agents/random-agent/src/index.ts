import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";

/**
 * Random agent: picks uniformly random arm targets each tick.
 * Useful as a baseline opponent.
 */
export function randomAgent(
  _agentId: AgentId,
  _state: WorldState
): AgentAction {
  return {
    leftArmTarget: Math.random() * 2 - 1, // [-1, 1]
    rightArmTarget: Math.random() * 2 - 1,
  };
}
