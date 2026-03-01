"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useMatchSocket } from "@/hooks/useMatchSocket";
import { useArenaStore } from "@/lib/store";
import { MatchHUD } from "@/components/MatchHUD";
import { ThoughtBubbles } from "@/components/ThoughtBubbles";
import { LobbyView } from "@/components/LobbyView";

// Dynamic import to avoid SSR issues with Three.js
const Arena3D = dynamic(
  () => import("@/components/Arena3D").then((mod) => mod.Arena3D),
  { ssr: false }
);

export default function Home() {
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const matchPhase = useArenaStore((s) => s.matchPhase);

  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => setWsUrl(data.serverWsUrl))
      .catch(() => setWsUrl("ws://localhost:3000/ws/spectator"));
  }, []);

  useMatchSocket(wsUrl);

  const showLobby = matchPhase === "waiting" || matchPhase === "disconnected";

  return (
    <main className="relative w-screen h-screen">
      <MatchHUD />
      {showLobby ? (
        <LobbyView />
      ) : (
        <ThoughtBubbles />
      )}
      <Arena3D />
    </main>
  );
}
