"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useMatchSocket } from "@/hooks/useMatchSocket";
import { MatchHUD } from "@/components/MatchHUD";
import { ThoughtBubbles } from "@/components/ThoughtBubbles";

// Dynamic import to avoid SSR issues with Three.js
const Arena3D = dynamic(
  () => import("@/components/Arena3D").then((mod) => mod.Arena3D),
  { ssr: false }
);

export default function Home() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  useEffect(() => {
    // Fetch the WS URL from our API route at runtime (avoids NEXT_PUBLIC bake-time issue)
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setWsUrl(data.serverWsUrl))
      .catch(() => setWsUrl("ws://localhost:3000/ws/spectator"));
  }, []);

  useMatchSocket(wsUrl);

  return (
    <main className="relative w-screen h-screen">
      <MatchHUD />
      <ThoughtBubbles />
      <Arena3D />
    </main>
  );
}
