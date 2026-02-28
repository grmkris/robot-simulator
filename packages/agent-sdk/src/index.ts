// HTTP client (recommended)
export { ArenaHttpClient } from "./http-client.js";
export type { ArenaHttpClientOptions } from "./http-client.js";

// Shared types
export type { AgentBrain, DecisionContext } from "./client.js";

// Legacy WebSocket client (deprecated — use ArenaHttpClient)
export { ArenaClient } from "./client.js";
export type { ArenaClientOptions } from "./client.js";
