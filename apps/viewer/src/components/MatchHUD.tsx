"use client";

import { useArenaStore } from "@/lib/store";

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function MatchHUD() {
  const { tick, time, matchPhase, connected, winner, winReason } =
    useArenaStore();

  return (
    <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
      {/* Top bar */}
      <div className="flex justify-between items-start p-4">
        {/* Connection status */}
        <div className="flex items-center gap-2 bg-black/60 backdrop-blur rounded-lg px-3 py-2 pointer-events-auto">
          <div
            className={`w-2 h-2 rounded-full ${
              connected ? "bg-green-400 animate-pulse" : "bg-red-500"
            }`}
          />
          <span className="text-xs text-gray-300 font-mono">
            {connected ? "LIVE" : "OFFLINE"}
          </span>
        </div>

        {/* Timer / Phase */}
        <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-2 text-center">
          <div className="text-2xl font-mono font-bold text-white">
            {matchPhase === "active" ? formatTime(time) : matchPhase.toUpperCase()}
          </div>
          <div className="text-xs text-gray-400 font-mono">
            TICK {tick}
          </div>
        </div>

        {/* Phase badge */}
        <div className="bg-black/60 backdrop-blur rounded-lg px-3 py-2">
          <span
            className={`text-xs font-mono font-bold ${
              matchPhase === "active"
                ? "text-green-400"
                : matchPhase === "finished"
                  ? "text-yellow-400"
                  : "text-gray-400"
            }`}
          >
            {matchPhase === "active" && "FIGHTING"}
            {matchPhase === "waiting" && "WAITING FOR AGENTS"}
            {matchPhase === "countdown" && "GET READY"}
            {matchPhase === "finished" && "MATCH OVER"}
            {matchPhase === "disconnected" && "CONNECTING..."}
          </span>
        </div>
      </div>

      {/* Robot labels */}
      <div className="flex justify-between px-8 mt-2">
        <div className="bg-blue-600/60 backdrop-blur rounded-lg px-4 py-2">
          <span className="text-sm font-bold text-white">ROBOT A</span>
        </div>
        <div className="bg-red-600/60 backdrop-blur rounded-lg px-4 py-2">
          <span className="text-sm font-bold text-white">ROBOT B</span>
        </div>
      </div>

      {/* Match result overlay */}
      {matchPhase === "finished" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-black/80 backdrop-blur-lg rounded-2xl px-10 py-8 text-center border border-white/10">
            <div className="text-lg text-gray-400 font-mono mb-2">
              MATCH RESULT
            </div>
            <div className="text-4xl font-bold text-white mb-2">
              {winner !== null ? (
                <span
                  className={
                    winner === 0 ? "text-blue-400" : "text-red-400"
                  }
                >
                  ROBOT {winner === 0 ? "A" : "B"} WINS
                </span>
              ) : (
                <span className="text-yellow-400">DRAW</span>
              )}
            </div>
            <div className="text-sm text-gray-400 font-mono uppercase">
              {winReason}
            </div>
          </div>
        </div>
      )}

      {/* Waiting overlay */}
      {(matchPhase === "disconnected" || matchPhase === "waiting") && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="bg-black/60 backdrop-blur rounded-xl px-8 py-6 text-center">
            <div className="text-xl text-white font-mono mb-2">
              AI ACTUATOR ARENA
            </div>
            <div className="text-sm text-gray-400 font-mono">
              {matchPhase === "disconnected"
                ? "Connecting to server..."
                : "Waiting for agents to connect..."}
            </div>
            <div className="mt-3 flex justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
