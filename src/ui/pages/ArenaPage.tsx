import { useMatchSocket } from "../hooks/useMatchSocket";
import { useArenaStore } from "../lib/store";
import { GridCanvas } from "../components/GridCanvas";
import { GameHUD } from "../components/GameHUD";
import { LobbyView } from "../components/LobbyView";
import { CatchUpControls } from "../components/CatchUpControls";
import { ErrorBoundary } from "../components/ErrorBoundary";

export default function ArenaPage() {
  const phase = useArenaStore((s) => s.phase);
  const catchUpMode = useArenaStore((s) => s.catchUpMode);

  useMatchSocket();

  const showLobby = phase === "lobby" && !catchUpMode;
  const showGame = catchUpMode || phase === "countdown" || phase === "active" || phase === "finished";

  return (
    <ErrorBoundary>
      <main className="relative w-screen h-screen bg-[#0a0a1a] flex flex-col items-center justify-center overflow-hidden">
        {showLobby && <LobbyView />}

        {showGame && (
          <>
            <div className="relative">
              <GridCanvas width={720} height={720} />
              <GameHUD />
            </div>
            {catchUpMode && <CatchUpControls />}
          </>
        )}
      </main>
    </ErrorBoundary>
  );
}
