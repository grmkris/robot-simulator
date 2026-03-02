// GridRoyale AI Client — plays the game using any LLM via Vercel AI SDK
//
// Uses a manual game loop with the REST API. The LLM only decides actions.
// This works reliably with ALL models (no multi-step tool calling required).
//
// Usage:
//   bun ai-client.ts --model anthropic:claude-sonnet-4-20250514
//   bun ai-client.ts --model openai:gpt-4o --name MyBot
//   bun ai-client.ts --model google:gemini-2.5-flash --loop
//   bun ai-client.ts --model google:gemini-2.5-pro
//   bun ai-client.ts --model xai:grok-3-mini
//   bun ai-client.ts --model groq:llama-3.3-70b-versatile
//   bun ai-client.ts --model openrouter:meta-llama/llama-4-scout
//   bun ai-client.ts --model ollama:llama3.2 --server http://localhost:9000

import { generateText, createProviderRegistry } from "ai";
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
    console.error("  bun ai-client.ts --model google:gemini-2.5-flash");
    console.error("  bun ai-client.ts --model google:gemini-2.5-pro");
    console.error("  bun ai-client.ts --model openai:gpt-4o");
    console.error("  bun ai-client.ts --model openrouter:meta-llama/llama-4-scout");
    console.error("\nEnvironment variables:");
    console.error("  ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY");
    console.error("  XAI_API_KEY, GROQ_API_KEY, FIREWORKS_API_KEY, OPENROUTER_API_KEY");
    process.exit(1);
  }

  const shortModel = model.split(":").pop()?.slice(0, 12) ?? "ai";
  const defaultName = `AI_${shortModel}_${Date.now().toString(36)}`;

  return {
    model,
    name: get("--name") ?? defaultName,
    server: get("--server") ?? "https://ai-arena-v2-production.up.railway.app",
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

// ── REST API helpers ────────────────────────────────────────────────
async function apiQueue(
  server: string,
  name: string,
): Promise<{ token: string; playerId: string }> {
  const res = await fetch(`${server}/api/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Queue failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function apiStep(
  server: string,
  token: string,
  action?: { t: string; dir?: string },
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(`${server}/api/step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(action ? { action } : {}),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return res.json();
      if (res.status >= 500) {
        console.error(`  [retry] Step got ${res.status}, retrying in ${2 ** attempt}s...`);
        await Bun.sleep(2 ** attempt * 1000);
        continue;
      }
      const text = await res.text();
      throw new Error(`Step failed (${res.status}): ${text}`);
    } catch (err) {
      if ((err as Error).message?.includes("Step failed")) throw err;
      console.error(`  [retry] Step error: ${(err as Error).message?.slice(0, 80)}, retrying...`);
      await Bun.sleep(2 ** attempt * 1000);
    }
  }
  throw new Error("Step failed after 5 retries");
}

// ── Action parsing ──────────────────────────────────────────────────
const VALID_ACTIONS = new Set(["MOVE", "DASH", "SHOOT", "PICKUP", "NOOP"]);
const VALID_DIRS = new Set(["N", "E", "S", "W"]);

function parseAction(
  text: string,
): { t: string; dir?: string } | undefined {
  // Extract action from model response — look for patterns like "MOVE N", "SHOOT E", "PICKUP", "NOOP"
  const cleaned = text.trim().toUpperCase();

  // Try to find action + direction pattern
  const match = cleaned.match(
    /\b(MOVE|DASH|SHOOT)\s+(N|E|S|W|NORTH|EAST|SOUTH|WEST)\b/,
  );
  if (match) {
    const dir = match[2].charAt(0); // N, E, S, W
    return { t: match[1], dir };
  }

  // Try standalone actions
  if (cleaned.includes("PICKUP")) return { t: "PICKUP" };
  if (cleaned.includes("NOOP")) return undefined; // NOOP = no action

  // Fallback: try to find any valid action
  for (const action of VALID_ACTIONS) {
    if (cleaned.includes(action)) {
      if (["MOVE", "DASH", "SHOOT"].includes(action)) {
        // Need a direction — find the nearest one
        const afterAction = cleaned.slice(cleaned.indexOf(action) + action.length);
        const dirMatch = afterAction.match(/\b([NESW])\b/);
        if (dirMatch) return { t: action, dir: dirMatch[1] };
      } else {
        return action === "NOOP" ? undefined : { t: action };
      }
    }
  }

  return undefined; // Default NOOP
}

// ── System prompt ───────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are playing GridRoyale, a battle royale game on a 40x40 grid. Be the last player alive to win.

You will receive game observations and must respond with EXACTLY ONE action.

## Actions
- MOVE N / MOVE E / MOVE S / MOVE W — Move 1 tile
- DASH N / DASH E / DASH S / DASH W — Move 2 tiles (costs 30 stamina, 8-tick cooldown)
- SHOOT N / SHOOT E / SHOOT S / SHOOT W — Fire projectile (costs 1 ammo, 2-tick cooldown)
- PICKUP — Collect item on your tile
- NOOP — Do nothing

## Strategy (Priority Order)
1. DODGE — If a projectile is heading toward you, MOVE or DASH perpendicular to dodge it.
2. STAY IN ZONE — If outside the safe zone, MOVE/DASH toward the zone center immediately.
3. PICKUP — If there's an item on your tile, use PICKUP (especially MEDKIT when low HP).
4. SHOOT — If an enemy is on the same row or column, SHOOT in their direction.
5. COLLECT — Move toward the nearest pickup (prioritize MEDKIT if HP < 60).
6. POSITION — Move toward zone center if nothing else to do.

## Rules
- Check the "Movement" section to see which directions are passable (not walls).
- Check the "Last Action" section to see if your previous action succeeded or failed.
- Zone shrinks every 50 ticks, 2 damage/tick outside. Stay in the zone!
- Projectiles move 1 tile/tick in cardinal directions.

## Response Format
Respond with ONLY the action. Example responses:
MOVE N
SHOOT E
DASH S
PICKUP
NOOP`;

// ── Format observation for LLM ──────────────────────────────────────
function formatObs(obs: Record<string, unknown>): string {
  // The REST API returns raw JSON observations. Format key info.
  const status = obs.status as string | undefined;

  if (status === "waiting" || status === "countdown") {
    return `[LOBBY] Status: ${status}, Players: ${JSON.stringify(obs.players ?? [])}`;
  }

  if (status === "finished") {
    const result = obs.result as Record<string, unknown> | undefined;
    return `[GAME OVER] ${JSON.stringify(result)}`;
  }

  // Active game — format the observation
  const tick = obs.tick ?? "?";
  const you = (obs.self ?? obs.you) as Record<string, unknown> | undefined;
  const visible = obs.visible as Record<string, unknown> | undefined;
  const zone = obs.zone as Record<string, unknown> | undefined;
  const lastAction = obs.lastAction as Record<string, unknown> | undefined;

  const playersAlive = obs.playersAlive ?? "?";

  const lines: string[] = [];
  lines.push(`=== Tick ${tick} | Players alive: ${playersAlive} ===`);

  if (you) {
    lines.push(
      `You: (${you.x},${you.y}) HP=${you.hp} Shield=${you.shield} Stamina=${you.stamina} Ammo=${you.ammo}`,
    );
    const cds = you.cooldowns as Record<string, unknown> | undefined;
    if (cds) {
      const cdParts: string[] = [];
      if (cds.shoot) cdParts.push(`shoot=${cds.shoot}`);
      if (cds.dash) cdParts.push(`dash=${cds.dash}`);
      if (cds.pickup) cdParts.push(`pickup=${cds.pickup}`);
      if (cdParts.length > 0) lines.push(`Cooldowns: ${cdParts.join(", ")}`);
    }
  }

  if (lastAction) {
    const success = lastAction.success ? "OK" : `FAILED (${lastAction.reason})`;
    const dir = lastAction.dir ? ` ${lastAction.dir}` : "";
    lines.push(`Last Action: ${lastAction.action}${dir} → ${success}`);
  }

  if (zone) {
    const tickNum = typeof tick === "number" ? tick : 0;
    const nextShrink = (Math.floor(tickNum / 50) + 1) * 50;
    lines.push(
      `Zone: center=(${zone.cx},${zone.cy}) radius=${zone.r} (shrinks at tick ${nextShrink})`,
    );
  }

  // Movement passability
  if (you && visible) {
    const x = you.x as number;
    const y = you.y as number;
    const tiles = (visible as Record<string, unknown>).tiles as Array<Record<string, unknown>> | undefined;
    const wallSet = new Set<string>();
    if (tiles) {
      for (const t of tiles) {
        if (t.t === 1) wallSet.add(`${t.x},${t.y}`); // TileType.WALL = 1
      }
    }
    const dirs = [
      { label: "N", dx: 0, dy: -1 },
      { label: "E", dx: 1, dy: 0 },
      { label: "S", dx: 0, dy: 1 },
      { label: "W", dx: -1, dy: 0 },
    ];
    const moveParts: string[] = [];
    for (const d of dirs) {
      const nx = x + d.dx;
      const ny = y + d.dy;
      if (nx < 0 || nx >= 40 || ny < 0 || ny >= 40) {
        moveParts.push(`${d.label}:blocked(edge)`);
      } else if (wallSet.has(`${nx},${ny}`)) {
        moveParts.push(`${d.label}:blocked(wall)`);
      } else {
        moveParts.push(`${d.label}:open`);
      }
    }
    lines.push(`Movement: ${moveParts.join(" | ")}`);
  }

  // Enemies
  const enemies = (visible as Record<string, unknown>)?.enemies as
    | Array<Record<string, unknown>>
    | undefined;
  if (enemies && enemies.length > 0) {
    lines.push("Enemies:");
    for (const e of enemies) {
      const dx = (e.x as number) - (you?.x as number ?? 0);
      const dy = (e.y as number) - (you?.y as number ?? 0);
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const shootable =
        dx === 0 || dy === 0 ? " SHOOTABLE" : "";
      const dir = dx === 0 ? (dy > 0 ? "S" : "N") : (dx > 0 ? "E" : "W");
      lines.push(
        `  Enemy at (${e.x},${e.y}) HP=${e.hp} Shield=${e.shield} dist=${dist} dir=${dir}${shootable}`,
      );
    }
  } else {
    lines.push("Enemies: none visible");
  }

  // Projectiles
  const projectiles = (visible as Record<string, unknown>)?.projectiles as
    | Array<Record<string, unknown>>
    | undefined;
  if (projectiles && projectiles.length > 0) {
    lines.push("Projectiles:");
    for (const p of projectiles) {
      const own = p.own ? "YOUR" : "ENEMY";
      lines.push(`  ${own} at (${p.x},${p.y}) dir=${p.dir}`);
    }
  }

  // Pickups
  const pickups = (visible as Record<string, unknown>)?.pickups as
    | Array<Record<string, unknown>>
    | undefined;
  if (pickups && pickups.length > 0) {
    lines.push("Pickups:");
    for (const p of pickups) {
      const dx = (p.x as number) - (you?.x as number ?? 0);
      const dy = (p.y as number) - (you?.y as number ?? 0);
      const dist = Math.abs(dx) + Math.abs(dy);
      const onTile = dist === 0 ? " (ON YOUR TILE!)" : "";
      lines.push(`  ${p.kind} at (${p.x},${p.y}) dist=${dist}${onTile}`);
    }
  }

  return lines.join("\n");
}

// ── Play one game ───────────────────────────────────────────────────
async function playGame(config: ReturnType<typeof parseArgs>) {
  const model = registry.languageModel(config.model);
  const tag = `[${config.name}]`;

  console.log(`${tag} Model: ${config.model}`);
  console.log(`${tag} Server: ${config.server}`);

  // Step 1: Queue
  const { token } = await apiQueue(config.server, config.name);
  console.log(`${tag} Queued successfully`);

  // Step 2: Wait for game to start (poll lobby)
  let obs: Record<string, unknown>;
  let pollCount = 0;
  while (true) {
    obs = await apiStep(config.server, token);
    const status = obs.status as string | undefined;
    if (status === "waiting" || status === "countdown") {
      pollCount++;
      if (pollCount % 5 === 1) {
        console.log(`${tag} Lobby: ${status} (${JSON.stringify(obs.players ?? [])})`);
      }
      continue;
    }
    break; // Game started or already finished
  }

  console.log(`${tag} Game started!`);

  // Step 3: Game loop — keep conversation history for context
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  let decisions = 0;

  while (true) {
    const status = obs.status as string | undefined;

    if (status === "finished") {
      console.log(`${tag} Game finished after ${decisions} decisions`);
      console.log(`${tag} Result: ${JSON.stringify(obs.result)}`);
      break;
    }

    const formatted = formatObs(obs);
    decisions++;

    // Add observation to conversation
    messages.push({ role: "user", content: formatted });

    // Keep only last 6 messages to prevent token explosion
    if (messages.length > 6) {
      messages.splice(0, messages.length - 6);
    }

    // Ask model for action
    try {
      const { text } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        messages,
        maxSteps: 1,
      });

      const action = parseAction(text);
      const actionStr = action ? `${action.t}${action.dir ? " " + action.dir : ""}` : "NOOP";

      // Add assistant response to history
      messages.push({ role: "assistant", content: text });

      if (decisions % 5 === 1 || decisions <= 3) {
        const youInfo = (obs.self ?? obs.you) as Record<string, unknown> | undefined;
        console.log(
          `${tag} T${obs.tick} | HP=${youInfo?.hp} | ${actionStr} | "${text.trim().slice(0, 60)}"`,
        );
      }

      // Submit action and get next observation
      obs = await apiStep(config.server, token, action);
    } catch (err) {
      console.error(`${tag} Error at tick ${obs.tick}:`, (err as Error).message?.slice(0, 100));
      try {
        obs = await apiStep(config.server, token);
      } catch {
        console.error(`${tag} Step also failed, waiting 5s...`);
        await Bun.sleep(5000);
        try {
          obs = await apiStep(config.server, token);
        } catch {
          console.error(`${tag} Server unreachable, giving up.`);
          break;
        }
      }
    }
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
      await Bun.sleep(2000);
      // Fresh name for next game
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
