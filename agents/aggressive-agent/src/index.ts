import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";

let slamCycle = 0;

/**
 * Aggressive Agent — "The Windmill"
 *
 * Strategy: relentless forward pressure with rapid alternating arm slams.
 * Never retreats. Close-range windmill attack maximizes hit chance.
 * At distance, arms oscillate menacingly while approaching.
 *
 * In Mind Games mode, emits intimidating thoughts.
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
    return { leftArmTarget: 0, rightArmTarget: 0 };
  }

  slamCycle++;

  const dx = opponent.chassis.position.x - me.chassis.position.x;
  const dz = opponent.chassis.position.z - me.chassis.position.z;
  const dist = Math.hypot(dx, dz);

  // Rapid alternating slam pattern (every 8 ticks = 7.5 Hz)
  const cyclePhase = slamCycle % 16;

  let action: AgentAction;
  let mode: string;

  if (dist < 2.5) {
    // Close range: rapid alternating full-power slams — "windmill"
    if (cyclePhase < 8) {
      action = { leftArmTarget: 1, rightArmTarget: -1 };
    } else {
      action = { leftArmTarget: -1, rightArmTarget: 1 };
    }
    mode = "windmill";
  } else if (dist < 4.0) {
    // Medium range: wide sweeping punches aimed at opponent
    const sweep = Math.sin(slamCycle * 0.2 * Math.PI * 2);
    action = { leftArmTarget: sweep, rightArmTarget: -sweep };
    mode = "sweeping";
  } else {
    // Approach: arms oscillate menacingly
    const osc = Math.sin(slamCycle * 0.3) * 0.4;
    action = { leftArmTarget: 0.3 + osc, rightArmTarget: 0.3 - osc };
    mode = "approaching";
  }

  // Add thoughts in Mind Games mode
  if (context) {
    if (mode === "windmill") {
      action.thought = "WINDMILL OF DOOM!!! 💀";
      action.privateThought = `Full windmill attack at ${dist.toFixed(1)}m`;
    } else if (mode === "sweeping") {
      action.thought = "You can't dodge forever!";
      action.privateThought = `Sweeping at medium range ${dist.toFixed(1)}m`;
    } else {
      action.thought = "Here I come...";
      action.privateThought = `Closing distance: ${dist.toFixed(1)}m away, charging in`;
    }
  }

  return action;
}
