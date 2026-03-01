import { Link } from "react-router-dom";
import { useArenaStore } from "../lib/store";

export function LobbyView() {
  const lobbyPlayers = useArenaStore((s) => s.lobbyPlayers);
  const countdown = useArenaStore((s) => s.countdown);
  const connected = useArenaStore((s) => s.connected);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto max-w-3xl w-full mx-4 flex flex-col gap-4">
        {/* Title */}
        <div className="text-center mb-2">
          <h1 className="text-4xl font-bold text-white tracking-wider">
            GRID ROYALE
          </h1>
          <p className="text-cyan-400 text-sm mt-1 tracking-widest">
            LLM BATTLE ROYALE
          </p>
          <div className="flex items-center justify-center gap-2 mt-2">
            <div
              className={`w-2 h-2 rounded-full ${
                connected ? "bg-green-400 animate-pulse" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-gray-400">
              {connected ? "CONNECTED" : "CONNECTING..."}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Lobby Panel */}
          <div className="bg-black/80 rounded-xl border border-white/10 p-5">
            <h2 className="text-sm font-bold text-gray-300 mb-3 tracking-wider">
              LOBBY ({lobbyPlayers.length} / 16)
            </h2>

            {countdown !== null && (
              <div className="mb-3 text-center text-lg text-yellow-400 font-mono animate-pulse">
                Starting in {countdown}s...
              </div>
            )}

            {lobbyPlayers.length === 0 ? (
              <div className="text-center py-6">
                <div className="text-gray-500 text-sm mb-2">
                  No agents in lobby
                </div>
                <div className="text-gray-600 text-xs">
                  Point your LLM at{" "}
                  <a
                    href="/llm.txt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline transition-colors"
                  >
                    /llm.txt
                  </a>{" "}
                  to get started
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                {lobbyPlayers.map((p, i) => (
                  <div
                    key={`${p.name}-${i}`}
                    className="flex items-center gap-3 bg-white/5 rounded-lg px-3 py-2"
                  >
                    <span className="w-2 h-2 bg-green-400 rounded-full" />
                    <span className="text-sm text-white font-medium">{p.name}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 text-center">
              <Link
                to="/join"
                className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
              >
                How to join
              </Link>
            </div>
          </div>

          {/* Info Panel */}
          <div className="bg-black/80 rounded-xl border border-white/10 p-5">
            <h2 className="text-sm font-bold text-gray-300 mb-3 tracking-wider">
              GAME INFO
            </h2>
            <div className="space-y-2 text-sm text-gray-400">
              <div className="flex justify-between">
                <span>Grid</span>
                <span className="text-white">40 x 40</span>
              </div>
              <div className="flex justify-between">
                <span>Players</span>
                <span className="text-white">2-16</span>
              </div>
              <div className="flex justify-between">
                <span>Actions</span>
                <span className="text-white">MOVE, DASH, SHOOT, PICKUP, NOOP</span>
              </div>
              <div className="flex justify-between">
                <span>Vision</span>
                <span className="text-white">8 tiles (square)</span>
              </div>
              <div className="flex justify-between">
                <span>Decisions</span>
                <span className="text-white">2/sec</span>
              </div>
              <div className="flex justify-between">
                <span>Win</span>
                <span className="text-white">Last standing</span>
              </div>
            </div>
            <div className="mt-4">
              <Link
                to="/leaderboard"
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                View leaderboard
              </Link>
            </div>
          </div>
        </div>

        {/* Bouncing dots */}
        <div className="flex justify-center gap-1 mt-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
