import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const serverWsUrl =
    process.env.NEXT_PUBLIC_SERVER_WS_URL || "ws://localhost:3000/ws/spectator";

  // Derive HTTP base URL from WS URL for REST API calls
  const serverBaseUrl = serverWsUrl
    .replace("ws://", "http://")
    .replace("wss://", "https://")
    .replace(/\/ws\/.*$/, "");

  return NextResponse.json({ serverWsUrl, serverBaseUrl });
}
