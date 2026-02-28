/**
 * Random Agent — HTTP client entry point.
 * Connects to the arena server and plays with random actions.
 */
import { ArenaHttpClient } from "@ai-arena/agent-sdk";
import { randomAgent } from "./index.js";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

const client = new ArenaHttpClient({
  serverUrl: SERVER_URL,
  name: "RandomBot",
  brain: randomAgent,
  pollIntervalMs: 100, // fast polling for responsive physics control
  onMatchEnd: (winner, reason) => {
    console.log(`[RandomBot] Match result: winner=${winner ?? "DRAW"} reason=${reason}`);
    setTimeout(() => process.exit(0), 500);
  },
});

await client.connect();
