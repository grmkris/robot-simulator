import { NextResponse } from "next/server";
import { getServerUrl } from "@/lib/server-url";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || "50";
    const agent = searchParams.get("agent") || "";
    const serverUrl = getServerUrl();
    const params = new URLSearchParams({ limit });
    if (agent) params.set("agent", agent);
    const res = await fetch(`${serverUrl}/api/match-history?${params}`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ matches: [], error: "Failed to fetch match history" }, { status: 502 });
  }
}
