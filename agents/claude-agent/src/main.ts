/**
 * Claude Agent — WebSocket client entry point.
 * Connects to the arena server with a Claude-powered AI brain.
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */
import { ArenaClient } from "@ai-arena/agent-sdk";
import { claudeBrain } from "./index.js";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[ClaudeAgent] ERROR: ANTHROPIC_API_KEY environment variable is required");
  process.exit(1);
}

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:3000/ws/agent";
const AGENT_NAME = process.env.AGENT_NAME || "Claude";

console.log(`[ClaudeAgent] Starting "${AGENT_NAME}" with Claude Haiku 4.5`);
console.log(`[ClaudeAgent] Server: ${SERVER_URL}`);

const client = new ArenaClient({
  serverUrl: SERVER_URL,
  name: AGENT_NAME,
  brain: claudeBrain,
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

client.connect();
