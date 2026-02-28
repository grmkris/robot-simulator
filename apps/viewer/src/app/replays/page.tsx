"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ReplayInfo {
  id: string;
  date: string;
  time: string;
}

function parseReplayId(id: string): ReplayInfo {
  // Format: match_YYYYMMDD_HHMMSS_xxxx
  const parts = id.split("_");
  const dateStr = parts[1] || "";
  const timeStr = parts[2] || "";

  const date = dateStr
    ? `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
    : "Unknown";
  const time = timeStr
    ? `${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:${timeStr.slice(4, 6)}`
    : "Unknown";

  return { id, date, time };
}

export default function ReplaysPage() {
  const [replays, setReplays] = useState<ReplayInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/replays")
      .then((res) => res.json())
      .then((data) => {
        const parsed = (data.replays || []).map(parseReplayId).reverse();
        setReplays(parsed);
        setLoading(false);
      })
      .catch((err) => {
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
              View past AI Actuator Arena matches
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
        {!loading && !error && replays.length === 0 && (
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
          {replays.map((replay) => (
            <div
              key={replay.id}
              className="bg-gray-900/50 border border-gray-800 rounded-lg p-4 hover:border-blue-500/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-sm text-white">
                    {replay.id}
                  </div>
                  <div className="text-gray-500 text-xs mt-1">
                    {replay.date} at {replay.time} UTC
                  </div>
                </div>
                <a
                  href={`/api/replays/${replay.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded text-xs font-mono transition-colors"
                >
                  VIEW JSON
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
