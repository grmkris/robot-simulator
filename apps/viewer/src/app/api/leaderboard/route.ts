import { NextResponse } from "next/server";
import { getServerUrl } from "@/lib/server-url";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/api/leaderboard`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ leaderboard: [], error: "Failed to fetch leaderboard" }, { status: 502 });
  }
}
