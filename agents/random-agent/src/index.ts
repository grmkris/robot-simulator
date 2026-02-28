import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";

const TAUNTS = [
  "Catch these random hands!",
  "I have no strategy and I'm proud!",
  "Pure chaos energy!",
  "You can't predict what I can't predict!",
  "Rolling the dice...",
  "Randomness is the best strategy!",
];

/**
 * Random agent: picks uniformly random arm targets each decision.
 * Now with random trash talk for Mind Games mode!
 */
export function randomAgent(
  _agentId: AgentId,
  _state: WorldState,
  context?: DecisionContext
): AgentAction {
  const action: AgentAction = {
    leftArmTarget: Math.random() * 2 - 1, // [-1, 1]
    rightArmTarget: Math.random() * 2 - 1,
  };

  // Add thoughts in Mind Games mode
  if (context) {
    action.thought = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
    action.privateThought = `Random roll: L=${action.leftArmTarget.toFixed(2)} R=${action.rightArmTarget.toFixed(2)}`;
  }

  return action;
}
