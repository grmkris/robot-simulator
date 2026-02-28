"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ReplaySummary {
  matchId: string;
  timestamp: string;
  result: { winner: number | null; reason: string; finalTick: number };
  frameCount: number;
}

export default function ReplaysPage() {
  const [summaries, setSummaries] = useState<ReplaySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/replays")
      .then((res) => res.json())
      .then((data) => {
        setSummaries(data.summaries || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load replays");
        setLoading(false);
      });
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-mono">Match History</h1>
            <p className="text-gray-400 text-sm mt-1">
              Watch past AI Actuator Arena matches
            </p>
          </div>
          <Link
            href="/"
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-mono transition-colors"
          >
            LIVE ARENA
          </Link>
        </div>

        {/* Loading */}
        {loading && (
          <div className="text-center py-12">
            <div className="text-gray-400 font-mono">Loading replays...</div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-red-900/30 border border-red-500/30 rounded-lg p-4 text-center">
            <span className="text-red-400 font-mono">{error}</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && summaries.length === 0 && (
          <div className="text-center py-12 border border-gray-800 rounded-lg">
            <div className="text-gray-500 font-mono text-lg mb-2">
              No matches yet
            </div>
            <div className="text-gray-600 text-sm">
              Connect two agents to start a match
            </div>
          </div>
        )}

        {/* Replay list */}
        <div className="space-y-3">
          {summaries.map((s) => {
            const date = new Date(s.timestamp);
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString();
            const durationSec = (s.result.finalTick / 60).toFixed(1);

            return (
              <Link
                key={s.matchId}
                href={`/replays/${s.matchId}`}
                className="block bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:border-blue-500/50 hover:bg-gray-900/80 transition-colors group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-white">
                        {s.result.winner !== null ? (
                          <span className={s.result.winner === 0 ? "text-blue-400" : "text-red-400"}>
                            Robot {s.result.winner === 0 ? "A" : "B"} wins
                          </span>
                        ) : (
                          <span className="text-yellow-400">Draw</span>
                        )}
                      </span>
                      <span className="text-gray-600 text-xs font-mono uppercase">
                        {s.result.reason.replace("_", " ")}
                      </span>
                    </div>
                    <div className="text-gray-500 text-xs mt-1 flex gap-4">
                      <span>{dateStr} {timeStr}</span>
                      <span>{durationSec}s ({s.result.finalTick} ticks)</span>
                    </div>
                  </div>
                  <div className="text-blue-400 font-mono text-sm opacity-0 group-hover:opacity-100 transition-opacity">
                    PLAY
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </main>
  );
}
