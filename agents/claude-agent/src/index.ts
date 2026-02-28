/**
 * Claude-Powered AI Agent — "The Mind Gamer"
 *
 * Uses Claude Haiku 4.5 for fast (~200ms) strategic decisions with
 * public thoughts (mind games) and private strategy (inner monologue).
 *
 * The agent receives tactical context and opponent's last public thought,
 * then decides arm positions AND what to say (bluffs, taunts, strategy).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AgentAction, AgentId, WorldState } from "@ai-arena/protocol";
import type { DecisionContext } from "@ai-arena/agent-sdk";

const anthropic = new Anthropic();

const SYSTEM_PROMPT = `You are a robot fighter in a sumo-style arena. Two robots charge at each other automatically — you only control your two arms.

CONTROLS:
- leftArmTarget: number from -1 (pulled back) to 1 (swung forward)
- rightArmTarget: number from -1 (pulled back) to 1 (swung forward)

ARENA:
- Circular arena, radius 5m. Fall off = you lose.
- Robots auto-charge toward each other. You can't move — only swing arms.
- Arms are like battering rams. Swing forward to push opponent, pull back to wind up.

STRATEGY TIPS:
- Alternating arms (one forward, one back) creates a windmill attack
- Both arms forward = maximum push (but no follow-up)
- Both arms back = wind up for a big hit (risky if opponent hits you)
- When near the edge, be careful — getting pushed is death
- Timing matters more than raw force

MIND GAMES:
- Your "thought" is visible to your opponent! Use it to:
  - Bluff: say you're going left when you go right
  - Intimidate: trash talk to distract them
  - Deceive: pretend to be scared when you're setting up an attack
  - Be honest sometimes — so they can't tell when you're lying
- Your "privateThought" is your real strategy (only spectators see it)

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "left": <number -1 to 1>,
  "right": <number -1 to 1>,
  "thought": "<what you say to opponent — they can see this!>",
  "private": "<your real strategy — only spectators see this>"
}`;

function formatGameState(context: DecisionContext): string {
  const t = context.tactical;
  const parts = [
    `Round ${context.round} | ${t.timeRemainingS}s remaining`,
    `Distance to opponent: ${t.distanceToOpponent}m`,
    `My distance from center: ${t.myDistFromCenter}m (arena radius: 5m)`,
    `Opponent distance from center: ${t.opponentDistFromCenter}m`,
    `Closing speed: ${t.closingSpeed}m/s (positive = approaching)`,
    `My speed: ${t.mySpeed}m/s | Opponent speed: ${t.opponentSpeed}m/s`,
    `My current arms: L=${context.currentAction.leftArmTarget.toFixed(2)} R=${context.currentAction.rightArmTarget.toFixed(2)}`,
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
      thought: typeof parsed.thought === "string" ? parsed.thought.slice(0, 200) : undefined,
      privateThought: typeof parsed.private === "string" ? parsed.private.slice(0, 200) : undefined,
    };
  } catch {
    // Fallback: aggressive stance
    return {
      leftArmTarget: 0.5,
      rightArmTarget: -0.5,
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
  // If no decision context (legacy tick mode), use simple fallback
  if (!context) {
    return {
      leftArmTarget: Math.sin(state.tick * 0.1),
      rightArmTarget: Math.sin(state.tick * 0.1 + Math.PI),
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
      thought: "Technical difficulties...",
      privateThought: `API error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}
