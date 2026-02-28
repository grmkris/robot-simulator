import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const serverWsUrl =
    process.env.NEXT_PUBLIC_SERVER_WS_URL || "ws://localhost:3000/ws/spectator";

  return NextResponse.json({ serverWsUrl });
}
