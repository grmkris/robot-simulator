/**
 * Heuristic Agent — WebSocket client entry point.
 * Connects to the arena server and plays with a chase-opponent strategy.
 */
import { ArenaClient } from "@ai-arena/agent-sdk";
import { heuristicAgent } from "./index.js";

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:3000/ws/agent";

const client = new ArenaClient({
  serverUrl: SERVER_URL,
  name: "HeuristicBot",
  brain: heuristicAgent,
  onMatchEnd: (winner, reason) => {
    console.log(`[HeuristicBot] Match result: winner=${winner ?? "DRAW"} reason=${reason}`);
    setTimeout(() => process.exit(0), 500);
  },
});

client.connect();
