/**
 * Aggressive Agent — WebSocket client entry point.
 * Connects to the arena server and plays with windmill slam strategy.
 */
import { ArenaClient } from "@ai-arena/agent-sdk";
import { aggressiveAgent } from "./index.js";

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:3000/ws/agent";

const client = new ArenaClient({
  serverUrl: SERVER_URL,
  name: "AggressiveBot",
  brain: aggressiveAgent,
  onMatchEnd: (winner, reason) => {
    console.log(
      `[AggressiveBot] Match result: winner=${winner ?? "DRAW"} reason=${reason}`
    );
    setTimeout(() => process.exit(0), 500);
  },
});

client.connect();
