import { NextResponse } from "next/server";
import { getServerUrl } from "@/lib/server-url";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const serverUrl = getServerUrl();
    const res = await fetch(`${serverUrl}/llm.txt`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const text = await res.text();
    return new NextResponse(text, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new NextResponse("Failed to fetch llm.txt from game server", { status: 502 });
  }
}
