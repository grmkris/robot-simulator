/**
 * Aggressive Agent — HTTP client entry point.
 * Connects to the arena server and plays with windmill slam strategy.
 */
import { ArenaHttpClient } from "@ai-arena/agent-sdk";
import { aggressiveAgent } from "./index.js";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

const client = new ArenaHttpClient({
  serverUrl: SERVER_URL,
  name: "AggressiveBot",
  brain: aggressiveAgent,
  pollIntervalMs: 100, // fast polling for responsive physics control
  onMatchEnd: (winner, reason) => {
    console.log(
      `[AggressiveBot] Match result: winner=${winner ?? "DRAW"} reason=${reason}`
    );
    setTimeout(() => process.exit(0), 500);
  },
});

await client.connect();
