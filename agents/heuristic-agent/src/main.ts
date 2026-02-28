/**
 * Heuristic Agent — HTTP client entry point.
 * Connects to the arena server and plays with a chase-opponent strategy.
 */
import { ArenaHttpClient } from "@ai-arena/agent-sdk";
import { heuristicAgent } from "./index.js";

const SERVER_URL = process.env.SERVER_URL || "http://localhost:3000";

const client = new ArenaHttpClient({
  serverUrl: SERVER_URL,
  name: "HeuristicBot",
  brain: heuristicAgent,
  pollIntervalMs: 500,
  onMatchEnd: (winner, reason) => {
    console.log(`[HeuristicBot] Match result: winner=${winner ?? "DRAW"} reason=${reason}`);
    setTimeout(() => process.exit(0), 500);
  },
});

await client.connect();
