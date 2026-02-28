#!/usr/bin/env bun
/**
 * Quick-play CLI for AI Actuator Arena.
 *
 * Usage:
 *   bun play.ts                          # aggressive vs heuristic (default)
 *   bun play.ts aggressive heuristic     # pick two agents
 *   bun play.ts random random            # random vs random
 *   bun play.ts claude aggressive        # claude vs aggressive (needs ANTHROPIC_API_KEY)
 *
 * Available agents: aggressive, heuristic, random, claude
 *
 * Watch live: https://arena-viewer-production.up.railway.app
 */

const AGENTS = ["aggressive", "heuristic", "random", "claude"] as const;
type AgentName = (typeof AGENTS)[number];

const AGENT_PATHS: Record<AgentName, string> = {
  aggressive: "agents/aggressive-agent/src/main.ts",
  heuristic: "agents/heuristic-agent/src/main.ts",
  random: "agents/random-agent/src/main.ts",
  claude: "agents/claude-agent/src/main.ts",
};

const SERVER_URL =
  process.env.SERVER_URL ||
  "https://authentic-simplicity-production-d41b.up.railway.app";

const [agent1Name, agent2Name] = [
  (process.argv[2] as AgentName) || "aggressive",
  (process.argv[3] as AgentName) || "heuristic",
];

if (!AGENTS.includes(agent1Name) || !AGENTS.includes(agent2Name)) {
  console.error(`Available agents: ${AGENTS.join(", ")}`);
  process.exit(1);
}

if (
  (agent1Name === "claude" || agent2Name === "claude") &&
  !process.env.ANTHROPIC_API_KEY
) {
  console.error("Claude agent requires ANTHROPIC_API_KEY env var.");
  process.exit(1);
}

console.log(`\n  AI Actuator Arena`);
console.log(`  ${agent1Name} vs ${agent2Name}`);
console.log(`  Server: ${SERVER_URL}`);
console.log(`  Watch:  https://arena-viewer-production.up.railway.app\n`);

const proc1 = Bun.spawn(["bun", "run", AGENT_PATHS[agent1Name]], {
  env: { ...process.env, SERVER_URL },
  stdout: "inherit",
  stderr: "inherit",
});

await Bun.sleep(1500);

const proc2 = Bun.spawn(["bun", "run", AGENT_PATHS[agent2Name]], {
  env: { ...process.env, SERVER_URL },
  stdout: "inherit",
  stderr: "inherit",
});

await Promise.all([proc1.exited, proc2.exited]);
console.log("\n  Match complete!\n");

export {};
