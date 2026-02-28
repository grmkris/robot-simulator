import type { AgentAction, WorldState, AgentId } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";

/**
 * Aggressive Heuristic Agent — "The Brawler"
 *
 * Strategy:
 * 1. Rapidly alternates arms for a windmill punching attack
 * 2. When close to opponent, does alternating power slams
 * 3. When near the edge, pulls arms back defensively
 * 4. Uses sinusoidal oscillation for unpredictable arm movement
 *
 * In Mind Games mode, emits tactical thoughts to psych out opponent.
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

  let action: AgentAction;
  let mode: string;

  // ── Close range: alternating power punches ──
  if (distToOpponent < 3) {
    const leftSwing = Math.sin(t * 0.15 * Math.PI * 2);
    const rightSwing = Math.sin(t * 0.15 * Math.PI * 2 + Math.PI);
    action = { leftArmTarget: leftSwing, rightArmTarget: rightSwing };
    mode = "brawling";
  }
  // ── Near edge: defensive — pull arms back ──
  else if (myDistFromCenter > 3.5) {
    action = { leftArmTarget: -0.8, rightArmTarget: -0.8 };
    mode = "defensive";
  }
  // ── Mid range: wind up for a big hit ──
  else {
    const windUp = Math.sin(t * 0.08 * Math.PI * 2);
    action = {
      leftArmTarget: windUp > 0 ? 1 : -0.5,
      rightArmTarget: windUp > 0 ? 1 : -0.5,
    };
    mode = "winding up";
  }

  // Add thoughts in Mind Games mode
  if (context) {
    const dist = context.tactical.distanceToOpponent;
    if (mode === "brawling") {
      action.thought = "FEEL MY FISTS!";
      action.privateThought = `Close range brawl — dist ${dist.toFixed(1)}m`;
    } else if (mode === "defensive") {
      action.thought = "Come closer, I dare you...";
      action.privateThought = `Near edge (${myDistFromCenter.toFixed(1)}m from center), playing defensive`;
    } else {
      action.thought = "Winding up something big...";
      action.privateThought = `Mid range wind-up, opponent at ${dist.toFixed(1)}m`;
    }
  }

  return action;
}
