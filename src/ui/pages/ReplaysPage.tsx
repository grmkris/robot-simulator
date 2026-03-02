import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

interface MatchPlayer {
  name: string;
  placement: number;
  kills: number;
  eloChange: number | null;
}

interface MatchEntry {
  id: string;
  seed: number;
  playerCount: number;
  winnerName: string | null;
  reason: string;
  totalTicks: number;
  durationS: number;
  timestamp: number;
  players: MatchPlayer[];
}

export default function ReplaysPage() {
  const [matches, setMatches] = useState<MatchEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/replays?limit=50")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setMatches(data.matches);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white p-8">
      <div className="max-w-3xl mx-auto">
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

        {loading && (
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
        )}

        {error && (
          <div className="text-center py-12 text-red-400 font-mono">
            Failed to load matches: {error}
          </div>
        )}

        {!loading && !error && matches.length === 0 && (
          <div className="text-center py-12 border border-gray-800 rounded-lg">
            <div className="text-gray-500 font-mono text-lg mb-2">
              No matches yet
            </div>
            <div className="text-gray-600 text-sm">
              Play some games to see them here
            </div>
          </div>
        )}

        {!loading && !error && matches.length > 0 && (
          <div className="space-y-3">
            {matches.map((m) => (
              <Link
                key={m.id}
                to={`/replays/${m.id}`}
                className="block border border-gray-800 rounded-lg p-4 hover:border-cyan-600 hover:bg-gray-900/50 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-cyan-400 font-mono text-sm">
                      {formatDate(m.timestamp)}
                    </span>
                    <span className="text-gray-500 font-mono text-xs">
                      {m.totalTicks} ticks
                    </span>
                    <span className="text-gray-500 font-mono text-xs">
                      {m.durationS.toFixed(1)}s
                    </span>
                  </div>
                  <span className="text-gray-600 font-mono text-xs">
                    {m.id.slice(0, 8)}
                  </span>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  {m.winnerName ? (
                    <span className="text-yellow-400 font-mono text-sm font-bold">
                      {m.winnerName} wins
                    </span>
                  ) : (
                    <span className="text-gray-400 font-mono text-sm">
                      Draw
                    </span>
                  )}
                  <span className="text-gray-600 text-xs">
                    ({m.playerCount} players)
                  </span>
                </div>

                <div className="flex flex-wrap gap-3">
                  {m.players
                    .sort((a, b) => a.placement - b.placement)
                    .map((p) => (
                      <div
                        key={p.name}
                        className="flex items-center gap-1.5 text-xs font-mono"
                      >
                        <span className={placementColor(p.placement)}>
                          #{p.placement}
                        </span>
                        <span className="text-gray-300">{p.name}</span>
                        {p.kills > 0 && (
                          <span className="text-red-400">{p.kills}k</span>
                        )}
                        {p.eloChange != null && (
                          <span
                            className={
                              p.eloChange >= 0
                                ? "text-green-400"
                                : "text-red-400"
                            }
                          >
                            {p.eloChange >= 0 ? "+" : ""}
                            {p.eloChange.toFixed(0)}
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;

  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function placementColor(p: number): string {
  if (p === 1) return "text-yellow-400";
  if (p === 2) return "text-gray-300";
  if (p === 3) return "text-orange-400";
  return "text-gray-500";
}
