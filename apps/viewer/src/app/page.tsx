"use client";

import dynamic from "next/dynamic";
import { useMatchSocket } from "@/hooks/useMatchSocket";
import { MatchHUD } from "@/components/MatchHUD";

// Dynamic import to avoid SSR issues with Three.js
const Arena3D = dynamic(
  () => import("@/components/Arena3D").then((mod) => mod.Arena3D),
  { ssr: false }
);

const SERVER_WS_URL =
  process.env.NEXT_PUBLIC_SERVER_WS_URL || "ws://localhost:3000/ws/spectator";

export default function Home() {
  useMatchSocket(SERVER_WS_URL);

  return (
    <main className="relative w-screen h-screen">
      <MatchHUD />
      <Arena3D />
    </main>
  );
}
