"use client";

import Link from "next/link";
import { useArenaStore } from "@/lib/store";

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function MatchHUD() {
  const { tick, time, matchPhase, connected, winner, winReason, agentNames, round, queue } =
    useArenaStore();

  // Don't show full HUD during waiting/disconnected — the LobbyView handles that
  const showFullHUD = matchPhase === "active" || matchPhase === "countdown" || matchPhase === "finished";

  return (
    <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
      {/* Top bar — always visible */}
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
          {queue.length > 0 && matchPhase === "active" && (
            <span className="text-xs text-gray-500 font-mono ml-1">
              {queue.length} queued
            </span>
          )}
        </div>

        {/* Timer / Phase */}
        {showFullHUD && (
          <div className="bg-black/60 backdrop-blur rounded-lg px-4 py-2 text-center">
            <div className="text-2xl font-mono font-bold text-white">
              {matchPhase === "active" ? formatTime(time) : matchPhase.toUpperCase()}
            </div>
            <div className="text-xs text-gray-400 font-mono">
              TICK {tick}
              {matchPhase === "active" && round > 0 && (
                <span className="ml-2 text-gray-500">R{round}</span>
              )}
            </div>
          </div>
        )}

        {/* Nav links */}
        <div className="flex items-center gap-2">
          <Link
            href="/leaderboard"
            className="bg-black/60 backdrop-blur rounded-lg px-3 py-2 pointer-events-auto hover:bg-white/10 transition-colors"
          >
            <span className="text-xs font-mono text-gray-300">RANKS</span>
          </Link>
          <Link
            href="/replays"
            className="bg-black/60 backdrop-blur rounded-lg px-3 py-2 pointer-events-auto hover:bg-white/10 transition-colors"
          >
            <span className="text-xs font-mono text-gray-300">REPLAYS</span>
          </Link>
          {showFullHUD && (
            <div className="bg-black/60 backdrop-blur rounded-lg px-3 py-2">
              <span
                className={`text-xs font-mono font-bold ${
                  matchPhase === "active"
                    ? "text-green-400"
                    : matchPhase === "finished"
                      ? "text-yellow-400"
                      : matchPhase === "countdown"
                        ? "text-cyan-400"
                        : "text-gray-400"
                }`}
              >
                {matchPhase === "active" && "MIND GAMES"}
                {matchPhase === "countdown" && "GET READY"}
                {matchPhase === "finished" && "MATCH OVER"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Robot labels — only during match */}
      {showFullHUD && (
        <div className="flex justify-between px-8 mt-2">
          <div className="bg-blue-600/60 backdrop-blur rounded-lg px-4 py-2">
            <span className="text-sm font-bold text-white">{agentNames.A}</span>
          </div>
          <div className="bg-red-600/60 backdrop-blur rounded-lg px-4 py-2">
            <span className="text-sm font-bold text-white">{agentNames.B}</span>
          </div>
        </div>
      )}

      {/* Countdown overlay */}
      {matchPhase === "countdown" && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <div className="text-lg text-gray-400 font-mono mb-2">
              <span className="text-blue-400">{agentNames.A}</span>
              {" vs "}
              <span className="text-red-400">{agentNames.B}</span>
            </div>
            <div className="text-8xl font-bold text-white animate-pulse">
              {Math.max(1, Math.ceil(5 - time))}
            </div>
            <div className="text-sm text-cyan-400 font-mono mt-2 tracking-widest">
              GET READY
            </div>
          </div>
        </div>
      )}

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
                  {winner === 0 ? agentNames.A : agentNames.B} WINS
                </span>
              ) : (
                <span className="text-yellow-400">DRAW</span>
              )}
            </div>
            <div className="text-sm text-gray-400 font-mono uppercase">
              {winReason}
            </div>
            {queue.length > 0 && (
              <div className="text-xs text-gray-500 font-mono mt-3">
                Next match: {queue.length} agent{queue.length > 1 ? "s" : ""} in queue
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
