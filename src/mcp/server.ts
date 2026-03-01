#!/usr/bin/env bun
// ═══════════════════════════════════════════════
// GridRoyale MCP Server — Let LLM agents play directly
// ═══════════════════════════════════════════════
//
// Usage:
//   bun src/mcp/server.ts
//
// This MCP server exposes tools that let an LLM agent
// BE the player — observe the game state, reason about
// strategy, and submit actions each decision tick.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ── Config ──

const DEFAULT_SERVER =
  process.env.GRIDROYALE_URL ??
  "https://ai-arena-v2-production.up.railway.app";

// ── Session State ──
// The MCP server manages one player session at a time.
// The agent doesn't need to deal with tokens.

let sessionToken: string | null = null;
let playerId: string | null = null;
let playerName: string | null = null;
let serverUrl = DEFAULT_SERVER;

// ── Helpers ──

async function apiPost(path: string, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
  const res = await fetch(`${serverUrl}${path}`, {
    method: "POST",
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

async function apiGet(path: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (sessionToken) headers["Authorization"] = `Bearer ${sessionToken}`;
  const res = await fetch(`${serverUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  return res.json();
}

function formatObservation(obs: any): string {
  if (!obs) return "No observation available.";

  // Lobby state
  if (obs.status === "waiting" || obs.status === "countdown") {
    return [
      `## Lobby`,
      `Status: ${obs.status}`,
      obs.countdown != null ? `Countdown: ${obs.countdown}s` : null,
      `Players: ${(obs.players ?? []).join(", ") || "none"}`,
      "",
      "Waiting for more players to join. Keep calling `step` to poll.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Game finished
  if (obs.status === "finished") {
    const r = obs.result;
    if (!r) return "Game finished. No result data.";
    const lines = [`## Game Over`, `Winner: ${r.winnerId ?? "none"}`, "", "### Placements"];
    for (const p of r.placements ?? []) {
      const marker = p.playerId === playerId ? " ← YOU" : "";
      lines.push(`  #${p.placement} ${p.name} (${p.kills} kills)${marker}`);
    }
    return lines.join("\n");
  }

  // Active game observation
  const me = obs.self;
  if (!me) return JSON.stringify(obs, null, 2);

  const zone = obs.zone;
  const enemies = obs.visible?.enemies ?? [];
  const pickups = obs.visible?.pickups ?? [];
  const projectiles = obs.visible?.projectiles ?? [];
  const events = obs.recentEvents ?? [];

  // Compute zone safety
  const myZoneDist = zone
    ? Math.max(Math.abs(me.x - zone.cx), Math.abs(me.y - zone.cy))
    : 0;
  const inZone = zone ? myZoneDist <= zone.r : true;

  const lines: string[] = [
    `## Tick ${obs.tick} | Decision #${obs.decisionIndex} | ${obs.playersAlive} alive`,
    "",
    `### You (${playerName})`,
    `  Position: (${me.x}, ${me.y}) facing ${me.facing}`,
    `  HP: ${me.hp}/100 | Shield: ${me.shield}/50 | Stamina: ${me.stamina}/100 | Ammo: ${me.ammo}/12`,
    `  Cooldowns: shoot=${me.cooldowns.shoot} dash=${me.cooldowns.dash} pickup=${me.cooldowns.pickup}`,
    "",
    `### Zone`,
    `  Center: (${zone?.cx}, ${zone?.cy}) Radius: ${zone?.r}`,
    `  You are ${inZone ? "INSIDE safe zone" : `OUTSIDE zone! Distance: ${myZoneDist} (taking 2 dmg/tick)`}`,
  ];

  if (enemies.length > 0) {
    lines.push("", `### Visible Enemies (${enemies.length})`);
    for (const e of enemies) {
      const dist = Math.max(Math.abs(e.x - me.x), Math.abs(e.y - me.y));
      const axisAligned =
        e.x === me.x ? `on same column (${e.y > me.y ? "S" : "N"})` :
        e.y === me.y ? `on same row (${e.x > me.x ? "E" : "W"})` : "diagonal";
      lines.push(`  ${e.id.slice(0, 6)} at (${e.x},${e.y}) hp=${e.hp} dist=${dist} ${axisAligned}`);
    }
  } else {
    lines.push("", "### No enemies visible");
  }

  if (pickups.length > 0) {
    lines.push("", `### Visible Pickups (${pickups.length})`);
    for (const p of pickups) {
      const dist = Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y));
      const onTile = p.x === me.x && p.y === me.y ? " ← ON YOUR TILE" : "";
      lines.push(`  ${p.kind} at (${p.x},${p.y}) dist=${dist}${onTile}`);
    }
  }

  if (projectiles.length > 0) {
    lines.push("", `### Projectiles (${projectiles.length})`);
    for (const p of projectiles) {
      const heading = p.dir;
      const willHit =
        (heading === "N" && p.x === me.x && p.y > me.y) ||
        (heading === "S" && p.x === me.x && p.y < me.y) ||
        (heading === "E" && p.y === me.y && p.x < me.x) ||
        (heading === "W" && p.y === me.y && p.x > me.x);
      lines.push(`  at (${p.x},${p.y}) heading ${heading}${willHit ? " ⚠ HEADING TOWARD YOU" : ""}`);
    }
  }

  // Recent kill events
  const kills = events.filter((e: any) => e.type === "KILL");
  if (kills.length > 0) {
    lines.push("", "### Recent Kills");
    for (const k of kills.slice(-3)) {
      const d = k.data;
      lines.push(`  ${d.killerId ?? "Zone"} killed ${d.victimId} (${d.weapon})`);
    }
  }

  lines.push(
    "",
    "### Available Actions",
    `  MOVE <N|E|S|W>  — Move 1 tile`,
    `  DASH <N|E|S|W>  — Move 2 tiles (30 stamina, ${me.cooldowns.dash > 0 ? `on cooldown: ${me.cooldowns.dash} ticks` : "ready"})`,
    `  SHOOT <N|E|S|W> — Fire projectile (${me.ammo > 0 ? `${me.ammo} ammo left` : "NO AMMO"}, ${me.cooldowns.shoot > 0 ? `cooldown: ${me.cooldowns.shoot}` : "ready"})`,
    `  PICKUP          — Collect item on your tile (${me.cooldowns.pickup > 0 ? `cooldown: ${me.cooldowns.pickup}` : "ready"})`,
    `  NOOP            — Do nothing`,
  );

  return lines.join("\n");
}

// ── MCP Server ──

const mcp = new McpServer({
  name: "gridroyale",
  version: "7.0.0",
});

// ── Tool: rules ──

mcp.tool(
  "gridroyale_rules",
  "Read the rules and strategy guide for GridRoyale. Call this FIRST before playing.",
  {},
  async () => {
    const res = await fetch(`${serverUrl}/llm.txt`, { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    return { content: [{ type: "text", text }] };
  },
);

// ── Tool: queue ──

mcp.tool(
  "gridroyale_queue",
  "Join a GridRoyale game. Choose a unique name. You'll wait in the lobby until 2+ players are ready, then the game starts automatically after a 10-second countdown.",
  {
    name: z.string().min(1).max(20).describe("Your bot name (unique, 1-20 chars)"),
    server: z.string().optional().describe("Server URL override (default: production)"),
  },
  async ({ name, server }) => {
    if (server) serverUrl = server.replace(/\/$/, "");

    if (sessionToken) {
      return {
        content: [{ type: "text", text: `Already in a session as "${playerName}". Use gridroyale_leave first to leave.` }],
      };
    }

    const data = (await apiPost("/api/queue", { name })) as any;
    if (data.error) {
      return { content: [{ type: "text", text: `Failed to queue: ${data.error}` }] };
    }

    sessionToken = data.token;
    playerId = data.playerId;
    playerName = name;

    return {
      content: [
        {
          type: "text",
          text: [
            `Joined as "${name}" (id: ${playerId})`,
            "",
            "You're in the lobby. The game starts when 2+ players join (10s countdown).",
            "",
            "Now call `gridroyale_step` repeatedly to:",
            "1. Wait through the lobby/countdown",
            "2. Receive game observations",
            "3. Submit your action each turn",
            "",
            "The step tool blocks until the next decision tick (0.5s), then returns your observation.",
          ].join("\n"),
        },
      ],
    };
  },
);

// ── Tool: step ──

mcp.tool(
  "gridroyale_step",
  `Submit your action and receive the next game observation. This is the main gameplay loop — call it repeatedly.

Actions:
- MOVE: Move 1 tile in direction (N/E/S/W)
- DASH: Move 2 tiles, costs 30 stamina, 8-tick cooldown
- SHOOT: Fire projectile in direction, costs 1 ammo, 2-tick cooldown
- PICKUP: Collect item on your tile
- NOOP: Do nothing (or omit action entirely)

The call blocks ~0.5s until the next decision tick, then returns your fog-filtered observation.`,
  {
    action: z
      .enum(["MOVE", "DASH", "SHOOT", "PICKUP", "NOOP"])
      .optional()
      .describe("Action to take this turn (default: NOOP)"),
    direction: z
      .enum(["N", "E", "S", "W"])
      .optional()
      .describe("Direction for MOVE/DASH/SHOOT (required for those actions)"),
  },
  async ({ action, direction }) => {
    if (!sessionToken) {
      return {
        content: [{ type: "text", text: "Not in a game. Call gridroyale_queue first." }],
      };
    }

    const body: any = {};
    if (action && action !== "NOOP") {
      body.action = { t: action };
      if (direction) body.action.dir = direction;
    }

    const obs = (await apiPost("/api/step", body)) as any;
    const formatted = formatObservation(obs);

    // Clear session on game end
    if (obs?.status === "finished") {
      sessionToken = null;
      playerId = null;
    }

    return { content: [{ type: "text", text: formatted }] };
  },
);

// ── Tool: observe ──

mcp.tool(
  "gridroyale_observe",
  "Get your current game observation without submitting an action. Useful to check the state before deciding.",
  {},
  async () => {
    if (!sessionToken) {
      return {
        content: [{ type: "text", text: "Not in a game. Call gridroyale_queue first." }],
      };
    }

    const obs = (await apiGet("/api/observe")) as any;
    const formatted = formatObservation(obs);
    return { content: [{ type: "text", text: formatted }] };
  },
);

// ── Tool: leave ──

mcp.tool(
  "gridroyale_leave",
  "Leave the current game or lobby. Use this to forfeit or reset your session.",
  {},
  async () => {
    if (!sessionToken) {
      return { content: [{ type: "text", text: "Not in a game." }] };
    }

    await apiPost("/api/leave");
    const name = playerName;
    sessionToken = null;
    playerId = null;
    playerName = null;
    return { content: [{ type: "text", text: `Left the game as "${name}".` }] };
  },
);

// ── Tool: leaderboard ──

mcp.tool(
  "gridroyale_leaderboard",
  "View the current Elo leaderboard rankings.",
  {},
  async () => {
    const data = (await apiGet("/api/leaderboard")) as any[];
    if (!data || data.length === 0) {
      return { content: [{ type: "text", text: "No agents ranked yet." }] };
    }

    const lines = ["## Leaderboard", ""];
    for (let i = 0; i < data.length; i++) {
      const e = data[i];
      const winRate = e.gamesPlayed > 0 ? Math.round((e.wins / e.gamesPlayed) * 100) : 0;
      lines.push(`#${i + 1} ${e.name} — Elo ${Math.round(e.elo)} (${e.wins}W/${e.losses}L, ${winRate}%)`);
    }
    return { content: [{ type: "text", text: lines.join("\n") }] };
  },
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  console.error("[GridRoyale MCP] Server started via stdio");
  console.error(`[GridRoyale MCP] Target: ${serverUrl}`);
}

main().catch((e) => {
  console.error("[GridRoyale MCP] Fatal:", e);
  process.exit(1);
});
