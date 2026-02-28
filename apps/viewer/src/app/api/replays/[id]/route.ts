import { NextResponse, type NextRequest } from "next/server";
import { getServerUrl } from "@/lib/server-url";

export const dynamic = "force-dynamic";

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
