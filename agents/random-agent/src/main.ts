/**
 * Random Agent — WebSocket client entry point.
 * Connects to the arena server and plays with random actions.
 */
import { ArenaClient } from "@ai-arena/agent-sdk";
import { randomAgent } from "./index.js";

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:3000/ws/agent";

const client = new ArenaClient({
  serverUrl: SERVER_URL,
  name: "RandomBot",
  brain: randomAgent,
  onMatchEnd: (winner, reason) => {
    const myId = 0; // Will be assigned by server
    console.log(`[RandomBot] Match result: winner=${winner ?? "DRAW"} reason=${reason}`);
    // Exit after a short delay to allow cleanup
    setTimeout(() => process.exit(0), 500);
  },
});

client.connect();
