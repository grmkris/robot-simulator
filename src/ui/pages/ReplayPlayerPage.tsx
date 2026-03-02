import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { useArenaStore } from "../lib/store";
import { GridCanvas } from "../components/GridCanvas";
import { GameHUD } from "../components/GameHUD";
import type { ViewerStateMessage } from "../lib/types";

interface ReplayPlayer {
  id: string;
  name: string;
  placement: number;
  kills: number;
  eloChange: number | null;
}

interface ReplayMatch {
  id: string;
  seed: number;
  playerCount: number;
  winnerName: string | null;
  reason: string;
  totalTicks: number;
  durationS: number;
  timestamp: number;
}

interface ReplayData {
  match: ReplayMatch;
  players: ReplayPlayer[];
  frames: ViewerStateMessage[];
}

const SPEEDS = [0.5, 1, 2, 4, 8];

export default function ReplayPlayerPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReplayData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(1); // 1x default

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { updateState, reset } = useArenaStore();

  // Fetch replay data
  useEffect(() => {
    if (!id) return;
    fetch(`/api/replays/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: ReplayData) => {
        setData(d);
        setLoading(false);
        // Show first frame
        if (d.frames.length > 0) {
          updateState(d.frames[0]!);
        }
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });

    return () => {
      reset();
    };
  }, [id, updateState, reset]);

  // Feed current frame into store
  const showFrame = useCallback(
    (idx: number) => {
      if (!data || idx < 0 || idx >= data.frames.length) return;
      updateState(data.frames[idx]!);
    },
    [data, updateState],
  );

  // Playback interval
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!playing || !data) return;

    const speed = SPEEDS[speedIdx]!;
    const ms = 100 / speed; // 100ms per sim tick at 1x (SIM_TPS=10)

    intervalRef.current = setInterval(() => {
      setFrameIdx((prev) => {
        const next = prev + 1;
        if (next >= data.frames.length) {
          setPlaying(false);
          return prev;
        }
        showFrame(next);
        return next;
      });
    }, ms);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speedIdx, data, showFrame]);

  // Scrub handler
  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value);
    setFrameIdx(idx);
    showFrame(idx);
  };

  const togglePlay = () => {
    if (!data) return;
    if (frameIdx >= data.frames.length - 1) {
      // At end — restart
      setFrameIdx(0);
      showFrame(0);
      setPlaying(true);
    } else {
      setPlaying(!playing);
    }
  };

  const cycleSpeed = () => {
    setSpeedIdx((prev) => (prev + 1) % SPEEDS.length);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#0a0a1a] text-white flex items-center justify-center">
        <div className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-[#0a0a1a] text-white flex flex-col items-center justify-center gap-4">
        <div className="text-red-400 font-mono">
          {error ?? "Match not found"}
        </div>
        <Link
          to="/replays"
          className="text-cyan-400 hover:underline font-mono text-sm"
        >
          Back to match history
        </Link>
      </main>
    );
  }

  const totalFrames = data.frames.length;
  const currentTick = data.frames[frameIdx]?.tick ?? 0;

  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white flex flex-col items-center">
      {/* Header */}
      <div className="w-full max-w-4xl flex items-center justify-between px-4 py-3">
        <Link
          to="/replays"
          className="text-cyan-400 hover:underline font-mono text-sm"
        >
          &larr; Back
        </Link>
        <div className="text-gray-400 font-mono text-sm">
          Replay: {data.match.id.slice(0, 8)}
        </div>
        <div className="text-gray-500 font-mono text-xs">
          {new Date(data.match.timestamp).toLocaleString()}
        </div>
      </div>

      {/* Canvas + HUD */}
      <div className="relative">
        <GridCanvas width={720} height={720} />
        <GameHUD />
      </div>

      {/* Transport controls */}
      <div className="w-full max-w-[720px] mt-4 px-4 space-y-3">
        {/* Scrubber */}
        <input
          type="range"
          min={0}
          max={totalFrames - 1}
          value={frameIdx}
          onChange={handleScrub}
          className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
        />

        {/* Controls row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={togglePlay}
              className="bg-cyan-600 hover:bg-cyan-500 text-white px-4 py-2 rounded-lg font-mono text-sm transition-colors"
            >
              {playing ? "PAUSE" : frameIdx >= totalFrames - 1 ? "REPLAY" : "PLAY"}
            </button>
            <button
              onClick={cycleSpeed}
              className="bg-gray-700 hover:bg-gray-600 text-white px-3 py-2 rounded-lg font-mono text-sm transition-colors min-w-[60px]"
            >
              {SPEEDS[speedIdx]}x
            </button>
          </div>

          <div className="font-mono text-sm text-gray-400">
            Tick {currentTick} / {data.match.totalTicks}
          </div>
        </div>
      </div>

      {/* Match info */}
      <div className="w-full max-w-[720px] mt-6 px-4 pb-8">
        <div className="border border-gray-800 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-mono text-sm text-gray-400">RESULTS</h3>
            <span className="text-gray-500 font-mono text-xs">
              Seed: {data.match.seed}
            </span>
          </div>

          <div className="space-y-1">
            {data.players
              .sort((a, b) => a.placement - b.placement)
              .map((p) => (
                <div
                  key={p.id}
                  className={`flex justify-between px-3 py-1.5 rounded text-sm font-mono ${
                    p.placement === 1
                      ? "bg-yellow-500/20 text-yellow-300"
                      : "bg-gray-800/50 text-gray-300"
                  }`}
                >
                  <span>
                    #{p.placement} {p.name}
                  </span>
                  <div className="flex gap-3">
                    <span className="text-red-400">{p.kills} kills</span>
                    {p.eloChange != null && (
                      <span
                        className={
                          p.eloChange >= 0 ? "text-green-400" : "text-red-400"
                        }
                      >
                        {p.eloChange >= 0 ? "+" : ""}
                        {p.eloChange.toFixed(0)} elo
                      </span>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </main>
  );
}
