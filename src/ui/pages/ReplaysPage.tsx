import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function ReplaysPage() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Replays will be loaded from DB in Phase 6
    setTimeout(() => setLoading(false), 500);
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold font-mono">Match History</h1>
            <p className="text-gray-400 text-sm mt-1">
              View past GridRoyale matches
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/leaderboard"
              className="bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-mono transition-colors"
            >
              RANKS
            </Link>
            <Link
              to="/"
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg text-sm font-mono transition-colors"
            >
              LIVE ARENA
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <div className="flex justify-center gap-1 mb-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <div className="text-gray-400 font-mono">Loading replays...</div>
          </div>
        ) : (
          <div className="text-center py-12 border border-gray-800 rounded-lg">
            <div className="text-gray-500 font-mono text-lg mb-2">
              Replay system coming soon
            </div>
            <div className="text-gray-600 text-sm">
              Deterministic replays via seed + intent logs will be available in a future update
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
