import { NextResponse } from "next/server";
import { getServerUrl } from "@/lib/server-url";

export const dynamic = "force-dynamic";

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
