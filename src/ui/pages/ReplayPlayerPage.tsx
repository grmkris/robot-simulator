import { Link } from "react-router-dom";

export default function ReplayPlayerPage() {
  return (
    <main className="min-h-screen bg-[#0a0a1a] text-white flex flex-col items-center justify-center gap-4">
      <div className="font-mono text-gray-400">
        Replay viewer coming soon
      </div>
      <p className="text-sm text-gray-500">
        Deterministic replays via seed + intent logs will be available in a future update
      </p>
      <Link
        to="/replays"
        className="text-cyan-400 hover:underline font-mono text-sm"
      >
        Back to match history
      </Link>
    </main>
  );
}
