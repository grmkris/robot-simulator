/**
 * Claude-Powered AI Agent — "The Mind Gamer"
 *
 * Uses Claude Haiku 4.5 for fast (~200ms) strategic decisions with
 * public thoughts (mind games) and private strategy (inner monologue).
 *
 * v4: Now controls movement (drive + turn) and shooting!
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentAction, AgentId, WorldState } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";
import { resolveAnthropicAuth } from "./auth.js";

const auth = resolveAnthropicAuth();
if (auth) {
  console.log(`[ClaudeAgent] Auth: ${auth.source}`);
}
const anthropic = new Anthropic({
  apiKey: auth?.apiKey,
});

const SYSTEM_PROMPT = `You are a robot fighter in a sumo-style arena with knockback projectiles.

CONTROLS (all values -1 to 1 unless noted):
- left: left arm target (-1=pulled back, 1=swung forward)
- right: right arm target (-1=pulled back, 1=swung forward)
- drive: forward/backward thrust (-1=full reverse, 1=full forward) in YOUR facing direction
- turn: yaw rotation (-1=turn left, 1=turn right)
- shoot: true/false — fire a knockback projectile (3 second cooldown)

ARENA:
- Circular arena, radius 10m. Fall off = you lose.
- YOU control movement — there is no auto-charge. You must drive and turn yourself.
- Arms are battering rams for close combat. Swing to push opponent off the edge.
- Projectiles don't damage — they PUSH the target backward (knockback). Great for edge kills!
- Projectile travels at 12 m/s in your facing direction. 2s lifetime, 3s cooldown between shots.

STRATEGY TIPS:
- Face your opponent (use turn), then shoot to push them toward the edge
- When opponent is near the edge, charge in with arms or shoot to finish them
- Stay near the center — it's the safest position
- Dodge incoming projectiles by strafing (turn + drive sideways)
- At close range, windmill arms (alternate left/right) for maximum push
- Shooting at range when aligned is very effective
- If your cooldown is 0, you can shoot again
- Watch your distance from center — getting too far out is dangerous

MIND GAMES:
- Your "thought" is visible to your opponent! Use it to bluff, intimidate, or deceive
- Your "private" thought is your real strategy (only spectators see it)

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "left": <number -1 to 1>,
  "right": <number -1 to 1>,
  "drive": <number -1 to 1>,
  "turn": <number -1 to 1>,
  "shoot": <true/false>,
  "thought": "<what opponent sees>",
  "private": "<your real strategy>"
}`;

function formatGameState(context: DecisionContext): string {
  const t = context.tactical;
  const parts = [
    `Time remaining: ${t.timeRemainingS}s`,
    `Distance to opponent: ${t.distanceToOpponent}m`,
    `My distance from center: ${t.myDistFromCenter}m (arena radius: 10m)`,
    `Opponent distance from center: ${t.opponentDistFromCenter}m`,
    `Closing speed: ${t.closingSpeed}m/s (positive = approaching)`,
    `My speed: ${t.mySpeed}m/s | Opponent speed: ${t.opponentSpeed}m/s`,
    `My facing angle: ${t.myFacingAngle.toFixed(2)} rad`,
    `Angle to opponent: ${t.angleToOpponent.toFixed(2)} rad (+=right, -=left, 0=directly ahead)`,
    `My shoot cooldown: ${t.myCooldownS}s (0 = ready)`,
    `Opponent shoot cooldown: ${t.opponentCooldownS}s`,
    `Incoming projectiles: ${t.incomingProjectiles}`,
    `My current: L=${context.currentAction.leftArmTarget.toFixed(2)} R=${context.currentAction.rightArmTarget.toFixed(2)} drive=${(context.currentAction.driveForce ?? 0).toFixed(2)} turn=${(context.currentAction.turnRate ?? 0).toFixed(2)}`,
  ];

  if (context.opponentThought) {
    parts.push(`\nOpponent says: "${context.opponentThought}"`);
  }

  return parts.join("\n");
}

function parseResponse(text: string): AgentAction {
  // Strip markdown code fences if present
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    return {
      leftArmTarget: Math.max(-1, Math.min(1, Number(parsed.left) || 0)),
      rightArmTarget: Math.max(-1, Math.min(1, Number(parsed.right) || 0)),
      driveForce: Math.max(-1, Math.min(1, Number(parsed.drive) || 0)),
      turnRate: Math.max(-1, Math.min(1, Number(parsed.turn) || 0)),
      shoot: Boolean(parsed.shoot),
      thought: typeof parsed.thought === "string" ? parsed.thought.slice(0, 200) : undefined,
      privateThought: typeof parsed.private === "string" ? parsed.private.slice(0, 200) : undefined,
    };
  } catch {
    // Fallback: drive forward and shoot
    return {
      leftArmTarget: 0.5,
      rightArmTarget: -0.5,
      driveForce: 0.5,
      turnRate: 0,
      shoot: true,
      thought: "...",
      privateThought: "Failed to parse Claude response, using fallback",
    };
  }
}

/**
 * Claude brain function — async, calls Haiku for each decision.
 */
export async function claudeBrain(
  agentId: AgentId,
  state: WorldState,
  context?: DecisionContext
): Promise<AgentAction> {
  // If no decision context (legacy tick mode), use simple approach
  if (!context) {
    const me = state.robots[agentId];
    const opp = state.robots[agentId === 0 ? 1 : 0];
    if (!me || !opp) return { leftArmTarget: 0, rightArmTarget: 0 };

    // Simple fallback: drive toward opponent
    const dx = opp.chassis.position.x - me.chassis.position.x;
    const dz = opp.chassis.position.z - me.chassis.position.z;
    const rot = me.chassis.rotation;
    const fw_x = 2 * (rot.x * rot.z + rot.w * rot.y);
    const fw_z = 1 - 2 * (rot.x * rot.x + rot.y * rot.y);
    const myFacing = Math.atan2(fw_x, fw_z);
    const dirTo = Math.atan2(dx, dz);
    let diff = dirTo - myFacing;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    return {
      leftArmTarget: Math.sin(state.tick * 0.1),
      rightArmTarget: Math.sin(state.tick * 0.1 + Math.PI),
      driveForce: 0.7,
      turnRate: Math.max(-1, Math.min(1, diff * 3)),
      shoot: Math.abs(diff) < 0.3,
    };
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: formatGameState(context),
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return {
        leftArmTarget: 0,
        rightArmTarget: 0,
        driveForce: 0.5,
        turnRate: 0,
        shoot: true,
        thought: "...",
        privateThought: "No text in Claude response",
      };
    }

    return parseResponse(textBlock.text);
  } catch (err) {
    console.error("[ClaudeAgent] API error:", err);
    // Fallback action on error
    return {
      leftArmTarget: Math.random() * 2 - 1,
      rightArmTarget: Math.random() * 2 - 1,
      driveForce: 0.5,
      turnRate: 0,
      shoot: true,
      thought: "Technical difficulties...",
      privateThought: `API error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
