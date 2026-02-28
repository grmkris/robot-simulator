/**
 * Claude Agent — HTTP client entry point.
 * Connects to the arena server with a Claude-powered AI brain.
 *
 * Auth (checked in order):
 * 1. ANTHROPIC_API_KEY env var
 * 2. ANTHROPIC_AUTH_TOKEN env var
 * 3. Claude Code OAuth token from ~/.claude/.credentials.json
 */
import { ArenaHttpClient } from "@ai-arena/agent-sdk";
import { resolveAnthropicAuth } from "./auth.js";

const auth = resolveAnthropicAuth();
if (!auth) {
  console.error(
    "[ClaudeAgent] ERROR: No Anthropic authentication found.\n" +
      "  Options:\n" +
      "  1. Set ANTHROPIC_API_KEY environment variable\n" +
      "  2. Set ANTHROPIC_AUTH_TOKEN environment variable\n" +
      "  3. Have Claude Code credentials at ~/.claude/.credentials.json"
  );
  process.exit(1);
}

// Dynamic import so auth check runs before the SDK initializes
const { claudeBrain } = await import("./index.js");

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";
const AGENT_NAME = process.env.AGENT_NAME || "Claude";

console.log(`[ClaudeAgent] Starting "${AGENT_NAME}" with Claude Haiku 4.5`);
console.log(`[ClaudeAgent] Server: ${SERVER_URL}`);

const client = new ArenaHttpClient({
  serverUrl: SERVER_URL,
  name: AGENT_NAME,
  brain: claudeBrain,
  pollIntervalMs: 1000, // LLM agent — longer interval for API call headroom
  onMatchEnd: (winner, reason) => {
    console.log(
      `[ClaudeAgent] Match result: winner=${winner ?? "DRAW"} reason=${reason}`
    );
    setTimeout(() => process.exit(0), 500);
  },
  onError: (error) => {
    console.error(`[ClaudeAgent] Error: ${error}`);
  },
});

await client.connect();
