import { useArenaStore } from "../lib/store";

export function ThoughtBubbles() {
  const thoughts = useArenaStore((s) => s.thoughts);
  const agentNames = useArenaStore((s) => s.agentNames);
  const matchPhase = useArenaStore((s) => s.matchPhase);
  const round = useArenaStore((s) => s.round);
  const programStep = useArenaStore((s) => s.programStep);
  const currentMoves = useArenaStore((s) => s.currentMoves);

  if (matchPhase !== "active" && matchPhase !== "finished") return null;

  const agentA = thoughts?.A;
  const agentB = thoughts?.B;

  return (
    <div className="absolute bottom-28 left-0 right-0 z-10 pointer-events-none">
      <div className="flex justify-between items-end px-4 gap-4">
        <ThoughtPanel name={agentNames.A} thought={agentA?.thought ?? null} privateThought={agentA?.privateThought ?? null} currentMove={programStep > 0 ? currentMoves?.A ?? null : null} color="blue" align="left" />
        <div className="flex-shrink-0 bg-black/60 rounded-lg px-3 py-1 mb-2">
          <span className="text-xs font-mono text-gray-400">
            {programStep > 0 ? `STEP ${programStep}/3` : `TURN ${round}`}
          </span>
        </div>
        <ThoughtPanel name={agentNames.B} thought={agentB?.thought ?? null} privateThought={agentB?.privateThought ?? null} currentMove={programStep > 0 ? currentMoves?.B ?? null : null} color="red" align="right" />
      </div>
    </div>
  );
}

function ThoughtPanel({
  name,
  thought,
  privateThought,
  currentMove,
  color,
  align,
}: {
  name: string;
  thought: string | null;
  privateThought: string | null;
  currentMove: string | null;
  color: "blue" | "red";
  align: "left" | "right";
}) {
  const borderColor = color === "blue" ? "border-blue-500/30" : "border-red-500/30";
  const bgColor = color === "blue" ? "bg-blue-950/60" : "bg-red-950/60";
  const nameColor = color === "blue" ? "text-blue-400" : "text-red-400";
  const textAlign = align === "left" ? "text-left" : "text-right";
  const hasContent = thought || privateThought || currentMove;

  return (
    <div className={`max-w-[280px] w-full ${bgColor} rounded-xl border ${borderColor} p-3 transition-all duration-300 ${hasContent ? "opacity-100" : "opacity-40"}`}>
      <div className={`text-xs font-mono font-bold ${nameColor} mb-1.5 ${textAlign}`}>{name}</div>
      {currentMove && (
        <div className={`${textAlign} mb-1.5`}>
          <span className="text-xs font-mono font-bold text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">{currentMove}</span>
        </div>
      )}
      {thought ? (
        <div className={`${textAlign} mb-1.5`}>
          <span className="text-sm text-white leading-snug">&ldquo;{thought}&rdquo;</span>
        </div>
      ) : (
        <div className={`${textAlign} mb-1.5`}>
          <span className="text-xs text-gray-500 italic">{currentMove ? "" : "thinking..."}</span>
        </div>
      )}
      {privateThought && (
        <div className={`${textAlign} border-t border-white/5 pt-1.5 mt-1`}>
          <span className="text-[10px] text-gray-500 uppercase tracking-wider block mb-0.5">inner monologue</span>
          <span className="text-xs text-gray-400 italic leading-snug">{privateThought}</span>
        </div>
      )}
    </div>
  );
}
