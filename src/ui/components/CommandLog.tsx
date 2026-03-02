import { useEffect, useRef } from "react";
import { useArenaStore } from "../lib/store";

const ACTION_COLORS: Record<string, string> = {
  SHOOT: "text-red-400",
  MOVE: "text-cyan-400",
  DASH: "text-purple-400",
  PICKUP: "text-green-400",
  NOOP: "text-gray-500",
};

export function CommandLog() {
  const commandHistory = useArenaStore((s) => s.commandHistory);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [commandHistory.length]);

  if (commandHistory.length === 0) return null;

  // Show last 15 ticks
  const visible = commandHistory.slice(-15);

  return (
    <div className="absolute right-3 bottom-16 w-56 bg-black/60 rounded-lg overflow-hidden pointer-events-auto">
      <div className="px-2 py-1 text-xs font-mono text-gray-400 border-b border-gray-700/50">
        ACTIONS
      </div>
      <div
        ref={scrollRef}
        className="max-h-[200px] overflow-y-auto px-1 py-1 space-y-1"
      >
        {visible.map((tick) => (
          <div key={tick.tick} className="space-y-px">
            <div className="text-[10px] font-mono text-gray-500 px-1">
              T{tick.tick}
            </div>
            {tick.entries.map((e) => (
              <div
                key={`${tick.tick}-${e.playerId}`}
                className="flex items-center gap-1 px-1 text-[11px] font-mono leading-tight"
              >
                <span className="text-gray-300 w-14 truncate shrink-0">
                  {e.playerName}
                </span>
                <span className={ACTION_COLORS[e.action] ?? "text-gray-400"}>
                  {e.action}
                </span>
                {e.dir && (
                  <span className="text-gray-400">{e.dir}</span>
                )}
                {!e.success && (
                  <span className="text-orange-400" title={e.reason}>
                    !
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default CommandLog;
