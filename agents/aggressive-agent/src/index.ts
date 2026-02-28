import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";

let slamCycle = 0;

/**
 * Aggressive Agent — "The Windmill"
 *
 * Strategy: relentless forward pressure with rapid alternating arm slams.
 * Never retreats. Close-range windmill attack maximizes hit chance.
 * At distance, arms oscillate menacingly while approaching.
 */
export function aggressiveAgent(
  agentId: AgentId,
  state: WorldState
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

  if (dist < 2.5) {
    // Close range: rapid alternating full-power slams — "windmill"
    if (cyclePhase < 8) {
      return { leftArmTarget: 1, rightArmTarget: -1 };
    } else {
      return { leftArmTarget: -1, rightArmTarget: 1 };
    }
  } else if (dist < 4.0) {
    // Medium range: wide sweeping punches aimed at opponent
    const sweep = Math.sin(slamCycle * 0.2 * Math.PI * 2);
    return {
      leftArmTarget: sweep,
      rightArmTarget: -sweep,
    };
  } else {
    // Approach: arms oscillate menacingly
    const osc = Math.sin(slamCycle * 0.3) * 0.4;
    return {
      leftArmTarget: 0.3 + osc,
      rightArmTarget: 0.3 - osc,
    };
  }
}
