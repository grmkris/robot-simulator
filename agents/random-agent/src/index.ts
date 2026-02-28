import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";

const TAUNTS = [
  "Catch these random hands!",
  "I have no strategy and I'm proud!",
  "Pure chaos energy!",
  "You can't predict what I can't predict!",
  "Rolling the dice...",
  "Randomness is the best strategy!",
  "PEW PEW! (maybe)",
  "Driving in circles is a valid tactic!",
];

/**
 * Random agent: picks uniformly random arm targets, movement, and shooting.
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
    driveForce: Math.random() * 2 - 1, // random forward/backward
    turnRate: Math.random() * 2 - 1, // random turning
    shoot: Math.random() < 0.3, // 30% chance to shoot each decision
  };

  // Add thoughts in Mind Games mode
  if (context) {
    action.thought = TAUNTS[Math.floor(Math.random() * TAUNTS.length)];
    action.privateThought = `Random: drive=${action.driveForce?.toFixed(2)} turn=${action.turnRate?.toFixed(2)} shoot=${action.shoot}`;
  }

  return action;
}
