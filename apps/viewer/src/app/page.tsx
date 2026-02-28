"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useMatchSocket } from "@/hooks/useMatchSocket";
import { MatchHUD } from "@/components/MatchHUD";

// Dynamic import to avoid SSR issues with Three.js
const Arena3D = dynamic(
  () => import("@/components/Arena3D").then((mod) => mod.Arena3D),
  { ssr: false }
);

function getServerWsUrl(): string {
  // Runtime detection: derive WS URL from current browser location
  if (typeof window !== "undefined") {
    const configuredUrl = process.env.NEXT_PUBLIC_SERVER_WS_URL;
    if (configuredUrl) return configuredUrl;

    // Default: assume server is on same host but port 3000 for local dev
    return "ws://localhost:3000/ws/spectator";
  }
  return "ws://localhost:3000/ws/spectator";
}

export default function Home() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  useEffect(() => {
    // Fetch the WS URL from our API route at runtime
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setWsUrl(data.serverWsUrl))
      .catch(() => setWsUrl(getServerWsUrl()));
  }, []);

  useMatchSocket(wsUrl);

  return (
    <main className="relative w-screen h-screen">
      <MatchHUD />
      <Arena3D />
    </main>
  );
}
