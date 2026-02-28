import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

function getServerUrl(): string {
  const wsUrl = process.env.NEXT_PUBLIC_SERVER_WS_URL || "";
  const httpUrl = wsUrl
    .replace("wss://", "https://")
    .replace("ws://", "http://")
    .replace(/\/ws\/spectator$/, "");
  return httpUrl || "http://localhost:3000";
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/api/replays/${id}`, { cache: "no-store" });
    if (!res.ok) {
      return NextResponse.json({ error: "Replay not found" }, { status: 404 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Failed to fetch replay" }, { status: 502 });
  }
}
