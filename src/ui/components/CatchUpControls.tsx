import { useEffect, useRef } from "react";
import { useArenaStore } from "../lib/store";

const SPEEDS = [0.5, 1, 2, 4, 8];

export function CatchUpControls() {
  const {
    catchUpMode,
    catchUpFrames,
    catchUpIndex,
    catchUpPlaying,
    catchUpSpeedIdx,
    setCatchUpIndex,
    setCatchUpPlaying,
    setCatchUpSpeedIdx,
    exitCatchUp,
  } = useArenaStore();

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Playback interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!catchUpPlaying || catchUpFrames.length === 0) return;

    const speed = SPEEDS[catchUpSpeedIdx] ?? 1;
    // Decision-tick frames are every 5 sim ticks, so 500ms real-time per frame at 1x
    const ms = 500 / speed;

    intervalRef.current = setInterval(() => {
      const state = useArenaStore.getState();
      const next = state.catchUpIndex + 1;
      if (next >= state.catchUpFrames.length) {
        // Reached the end — transition to live
        setCatchUpPlaying(false);
        exitCatchUp();
        return;
      }
      setCatchUpIndex(next);
    }, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [catchUpPlaying, catchUpSpeedIdx, catchUpFrames.length, setCatchUpIndex, setCatchUpPlaying, exitCatchUp]);

  if (!catchUpMode || catchUpFrames.length === 0) return null;

  const totalFrames = catchUpFrames.length;
  const currentTick = catchUpFrames[catchUpIndex]?.tick ?? 0;
  const lastTick = catchUpFrames[totalFrames - 1]?.tick ?? 0;

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    setCatchUpPlaying(false);
    setCatchUpIndex(idx);
  };

  const togglePlay = () => {
    if (catchUpIndex >= totalFrames - 1) {
      // At end — restart
      setCatchUpIndex(0);
      setCatchUpPlaying(true);
    } else {
      setCatchUpPlaying(!catchUpPlaying);
    }
  };

  const cycleSpeed = () => {
    setCatchUpSpeedIdx((catchUpSpeedIdx + 1) % SPEEDS.length);
  };

  return (
    <div className="w-full max-w-[720px] mt-3 px-4 space-y-2">
      {/* Catch-up indicator */}
      <div className="flex items-center justify-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
        <span className="text-xs font-mono text-yellow-400">
          CATCHING UP
        </span>
      </div>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={totalFrames - 1}
        value={catchUpIndex}
        onChange={handleScrub}
        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500"
      />

      {/* Controls row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            className="bg-yellow-600 hover:bg-yellow-500 text-white px-3 py-1.5 rounded-lg font-mono text-xs transition-colors"
          >
            {catchUpPlaying ? "PAUSE" : "PLAY"}
          </button>
          <button
            onClick={cycleSpeed}
            className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1.5 rounded-lg font-mono text-xs transition-colors min-w-[48px]"
          >
            {SPEEDS[catchUpSpeedIdx]}x
          </button>
          <button
            onClick={exitCatchUp}
            className="bg-cyan-600 hover:bg-cyan-500 text-white px-3 py-1.5 rounded-lg font-mono text-xs transition-colors"
          >
            SKIP TO LIVE
          </button>
        </div>

        <div className="font-mono text-xs text-gray-400">
          Tick {currentTick} / {lastTick}
        </div>
      </div>
    </div>
  );
}

export default CatchUpControls;
