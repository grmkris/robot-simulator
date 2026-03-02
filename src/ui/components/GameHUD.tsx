import { useArenaStore } from "../lib/store";
import { CommandLog } from "./CommandLog";

export function GameHUD() {
  const { phase, tick, playersAlive, players, zone, countdown, killFeed, winnerName, winReason, placements } =
    useArenaStore();

  return (
    <div className="absolute inset-0 pointer-events-none">
      {/* Top bar */}
      <div className="flex justify-between items-center p-3">
        <div className="bg-black/60 rounded-lg px-3 py-1.5 text-sm font-mono text-white pointer-events-auto">
          {phase === "lobby" && "Waiting for players..."}
          {phase === "countdown" && countdown !== null && `Starting in ${countdown}s`}
          {phase === "active" && `Tick ${tick}`}
          {phase === "finished" && "Game Over"}
        </div>

        {phase === "active" && (
          <div className="bg-black/60 rounded-lg px-3 py-1.5 text-sm font-mono text-white">
            {playersAlive} alive | Zone R:{zone.r}
          </div>
        )}
      </div>

      {/* Player list (right side) */}
      {phase === "active" && players.length > 0 && (
        <div className="absolute right-3 top-14 bg-black/60 rounded-lg p-2 max-h-[60vh] overflow-y-auto pointer-events-auto">
          <div className="text-xs font-mono text-gray-400 mb-1 px-1">PLAYERS</div>
          {players
            .slice()
            .sort((a, b) => (a.alive === b.alive ? b.kills - a.kills : a.alive ? -1 : 1))
            .map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 px-1 py-0.5 text-xs font-mono ${
                  p.alive ? "text-white" : "text-gray-500 line-through"
                }`}
              >
                <span className="w-16 truncate">{p.name}</span>
                <span className={p.alive ? "text-green-400" : "text-red-400"}>
                  {p.hp}hp
                </span>
                <span className="text-yellow-400">{p.kills}k</span>
              </div>
            ))}
        </div>
      )}

      {/* Kill feed (bottom left) */}
      {killFeed.length > 0 && (
        <div className="absolute left-3 bottom-16 space-y-1">
          {killFeed.slice(-5).map((kill, i) => (
            <div
              key={`${kill.tick}-${kill.victimId}-${i}`}
              className="bg-black/60 rounded px-2 py-1 text-xs font-mono text-white"
            >
              {kill.killerName ? (
                <>
                  <span className="text-red-400">{kill.killerName}</span>
                  {" killed "}
                  <span className="text-gray-400">{kill.victimName}</span>
                  <span className="text-gray-500 ml-1">({kill.weapon})</span>
                </>
              ) : (
                <>
                  <span className="text-gray-400">{kill.victimName}</span>
                  <span className="text-red-400"> died to zone</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Command history (bottom right) */}
      {(phase === "active" || phase === "countdown") && <CommandLog />}

      {/* Game over overlay */}
      {phase === "finished" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-auto">
          <div className="bg-gray-900/95 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4">
            <h2 className="text-2xl font-bold text-white text-center mb-2">Game Over</h2>
            {winnerName && (
              <p className="text-center text-lg text-yellow-400 mb-1">
                Winner: {winnerName}
              </p>
            )}
            {winReason && (
              <p className="text-center text-sm text-gray-400 mb-4">{winReason}</p>
            )}

            {placements.length > 0 && (
              <div className="space-y-1">
                {placements.map((p) => (
                  <div
                    key={p.playerId}
                    className={`flex justify-between px-3 py-1.5 rounded text-sm font-mono ${
                      p.placement === 1
                        ? "bg-yellow-500/20 text-yellow-300"
                        : "bg-gray-800 text-gray-300"
                    }`}
                  >
                    <span>
                      #{p.placement} {p.name}
                    </span>
                    <span>{p.kills} kills</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default GameHUD;
