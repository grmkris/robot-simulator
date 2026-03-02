// GridRoyale AI Client — plays the game using any LLM via Vercel AI SDK + MCP
//
// Usage:
//   bun ai-client.ts --model anthropic:claude-sonnet-4-20250514
//   bun ai-client.ts --model openai:gpt-4o --name MyBot
//   bun ai-client.ts --model google:gemini-2.5-flash --loop
//   bun ai-client.ts --model xai:grok-3-mini
//   bun ai-client.ts --model groq:llama-3.3-70b-versatile
//   bun ai-client.ts --model fireworks:accounts/fireworks/models/llama-v3p1-70b-instruct
//   bun ai-client.ts --model openrouter:meta-llama/llama-4-scout
//   bun ai-client.ts --model openrouter:deepseek/deepseek-r1
//   bun ai-client.ts --model openrouter:mistralai/mistral-large
//   bun ai-client.ts --model ollama:llama3.2 --server http://localhost:9000/mcp

import { generateText, createProviderRegistry } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { xai } from "@ai-sdk/xai";
import { groq } from "@ai-sdk/groq";
import { fireworks } from "@ai-sdk/fireworks";
import { openrouter } from "@openrouter/ai-sdk-provider";
import { ollama } from "ollama-ai-provider";

// ── CLI args ────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  const model = get("--model");
  if (!model) {
    console.error(
      "Usage: bun ai-client.ts --model <provider:model> [--name BotName] [--server URL] [--loop]"
    );
    console.error("\nExamples:");
    console.error("  bun ai-client.ts --model anthropic:claude-sonnet-4-20250514");
    console.error("  bun ai-client.ts --model openai:gpt-4o");
    console.error("  bun ai-client.ts --model google:gemini-2.5-flash");
    console.error("  bun ai-client.ts --model xai:grok-3-mini");
    console.error("  bun ai-client.ts --model groq:llama-3.3-70b-versatile");
    console.error("  bun ai-client.ts --model fireworks:accounts/fireworks/models/llama-v3p1-70b-instruct");
    console.error("  bun ai-client.ts --model openrouter:meta-llama/llama-4-scout");
    console.error("  bun ai-client.ts --model openrouter:deepseek/deepseek-r1");
    console.error("  bun ai-client.ts --model ollama:llama3.2");
    console.error("\nEnvironment variables:");
    console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY");
    console.error("  XAI_API_KEY, GROQ_API_KEY, FIREWORKS_API_KEY, OPENROUTER_API_KEY");
    console.error("  (ollama runs locally, no API key needed)");
    process.exit(1);
  }

  const shortModel = model.split(":").pop()?.slice(0, 12) ?? "ai";
  const defaultName = `AI_${shortModel}_${Date.now().toString(36)}`;

  return {
    model,
    name: get("--name") ?? defaultName,
    server: get("--server") ?? "https://ai-arena-v2-production.up.railway.app/mcp",
    loop: has("--loop"),
  };
}

// ── Provider registry ───────────────────────────────────────────────
const registry = createProviderRegistry({
  anthropic,
  openai,
  google,
  xai,
  groq,
  fireworks,
  openrouter,
  ollama,
});

// ── System prompt ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an AI agent playing GridRoyale, a battle royale game on a 40x40 grid.

## Your Goal
Win the game by being the last player alive.

## How to Play
1. First, call gridroyale_queue with your bot name to join a game.
2. Then repeatedly call gridroyale_step with your chosen action.
3. Each step returns your observation — read it carefully and decide your next action.
4. Keep calling gridroyale_step until the game ends (status: "finished").

## Strategy (Priority Order)
1. **DODGE** — If a projectile is heading toward you, MOVE or DASH perpendicular to dodge it.
2. **STAY IN ZONE** — If outside the safe zone, MOVE/DASH toward the zone center immediately.
3. **PICKUP** — If there's an item on your tile, use PICKUP (especially MEDKIT when low HP).
4. **SHOOT** — If an enemy is on the same row or column, SHOOT in their direction.
5. **COLLECT** — Move toward the nearest pickup (prioritize MEDKIT if HP < 60).
6. **POSITION** — Move toward zone center if nothing else to do.

## Actions
- MOVE <N|E|S|W> — Move 1 tile
- DASH <N|E|S|W> — Move 2 tiles (costs 30 stamina, 8-tick cooldown)
- SHOOT <N|E|S|W> — Fire projectile (costs 1 ammo, 2-tick cooldown)
- PICKUP — Collect item on your tile
- NOOP — Do nothing

## Important Rules
- ALWAYS provide an action with gridroyale_step — never call it without one during active gameplay.
- Be decisive. You have limited time per decision tick.
- Check cooldowns before using DASH or SHOOT.
- The zone shrinks every 50 ticks and deals 2 damage/tick if you're outside it.
- You can only see enemies within 8 tiles (Chebyshev distance).

## During Lobby
While waiting for the game to start (status: "waiting" or "countdown"), call gridroyale_step with no action to poll.`;

// ── Play one game ───────────────────────────────────────────────────
async function playGame(config: ReturnType<typeof parseArgs>) {
  const model = registry.languageModel(config.model);

  const mcpClient = await createMCPClient({
    transport: { type: "http", url: config.server },
  });

  try {
    const tools = await mcpClient.tools();

    console.log(`[${config.name}] Connected to MCP server at ${config.server}`);
    console.log(`[${config.name}] Model: ${config.model}`);
    console.log(`[${config.name}] Available tools: ${Object.keys(tools).join(", ")}`);
    console.log(`[${config.name}] Starting game...\n`);

    const { text, steps } = await generateText({
      model,
      tools,
      system: SYSTEM_PROMPT,
      prompt: `Your bot name is "${config.name}". Join the game and play to win! Start by calling gridroyale_queue with your name, then keep calling gridroyale_step with actions until the game is over.`,
      maxSteps: 200,
      onStepFinish({ text, toolCalls, toolResults }) {
        for (const call of toolCalls) {
          const argStr =
            call.args && Object.keys(call.args).length > 0
              ? ` ${JSON.stringify(call.args)}`
              : "";
          console.log(`  → ${call.toolName}${argStr}`);
        }
        for (const result of toolResults) {
          // Print a truncated version of tool results
          const content = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
          const lines = content.split("\n");
          const preview = lines.slice(0, 3).join("\n");
          if (lines.length > 3) {
            console.log(`  ← ${preview}\n    ... (${lines.length - 3} more lines)`);
          } else {
            console.log(`  ← ${preview}`);
          }
        }
        if (text) {
          console.log(`  💬 ${text.slice(0, 200)}`);
        }
      },
    });

    const totalToolCalls = steps.reduce((n, s) => n + s.toolCalls.length, 0);
    console.log(`\n[${config.name}] Game complete. ${steps.length} steps, ${totalToolCalls} tool calls.`);
    if (text) {
      console.log(`[${config.name}] Final response:\n${text}`);
    }
  } finally {
    await mcpClient.close();
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  const config = parseArgs();

  if (config.loop) {
    let game = 1;
    while (true) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`  Game #${game++}`);
      console.log(`${"=".repeat(60)}\n`);
      try {
        await playGame(config);
      } catch (err) {
        console.error(`[${config.name}] Error:`, err);
      }
      // Brief pause between games
      await Bun.sleep(2000);
      // Generate a fresh name for next game
      config.name = config.name.replace(/_[a-z0-9]+$/, `_${Date.now().toString(36)}`);
    }
  } else {
    await playGame(config);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
