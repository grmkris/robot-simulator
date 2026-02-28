import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function getServerUrl(): string {
  // Runtime: use the HTTP version of the server URL
  const wsUrl = process.env.NEXT_PUBLIC_SERVER_WS_URL || "";
  const httpUrl = wsUrl
    .replace("wss://", "https://")
    .replace("ws://", "http://")
    .replace(/\/ws\/spectator$/, "");
  return httpUrl || "http://localhost:3000";
}

export async function GET() {
  try {
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/api/replays`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ replays: [], error: "Failed to fetch replays" }, { status: 502 });
  }
}
