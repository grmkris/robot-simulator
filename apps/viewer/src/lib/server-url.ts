/**
 * Derive the game server HTTP base URL from the WS URL environment variable.
 * Used by API proxy routes to forward requests to the game server.
 */
export function getServerUrl(): string {
  const wsUrl = process.env.NEXT_PUBLIC_SERVER_WS_URL || "";
  const httpUrl = wsUrl
    .replace("wss://", "https://")
    .replace("ws://", "http://")
    .replace(/\/ws\/spectator$/, "");
  return httpUrl || "http://localhost:3000";
}
