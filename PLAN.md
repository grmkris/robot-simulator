# Turn-Based Arena Refactor Plan

## Problem
The game runs real-time (60Hz physics, 10s inactivity timeout). LLM agents via MCP tools take 3-10s per round-trip and get disconnected before they can play.

## Solution
Convert to **turn-based mode** as the default for ALL matches. Server waits for both agents to submit actions before advancing physics.

## How It Works

1. Match starts → run countdown (300 ticks) synchronously, broadcast frames
2. Enter active phase with **turn loop**:
   - Run **12 physics ticks** (200ms game time) with current actions
   - Broadcast final frame to viewer
   - Mark both agents as "awaiting action"
   - **Wait** for both agents to submit actions (30s per-turn timeout)
   - Once both submit (or timeout) → repeat
3. Match ends normally (ring out, timeout at 60s game time, disconnect)

Result: 300 turns per 60s match. Agents can take up to 30s per decision. Physics is identical.

## Files to Change

### 1. `packages/protocol/src/constants.ts`
- Add `TICKS_PER_TURN = 12` (200ms game time per turn)
- Add `TURN_TIMEOUT_MS = 30_000` (30s per-turn timeout)
- Bump `PROTOCOL_VERSION` to 5

### 2. `packages/protocol/src/types.ts`
- Add to `GameStateResponse`:
  - `turn?: number` — current turn number
  - `awaitingAction?: boolean` — "it's your turn, submit an action"

### 3. `packages/sim/src/game-loop.ts`
- Add `runTurn(ticksPerTurn: number)` method that runs N ticks synchronously and returns all states
- Keep existing `start()`/`stop()` but primary path is now `runTurn()`

### 4. `apps/server/src/match-manager.ts` (biggest change)
- Replace `startMatch()` real-time loop with async turn-based loop:
  ```
  async startMatch():
    init sim
    run countdown (300 ticks synchronously, broadcast frames)
    while sim.phase === "active":
      run 12 ticks synchronously with actionProvider
      broadcast final frame to viewer
      reset turn action flags
      currentTurn++
      await waitForBothActions() — Promise resolves when both submit or 30s timeout
    handleMatchEnd()
  ```
- Add to `ConnectedAgent`: `hasActedThisTurn: boolean`
- Modify `receiveAction()`: set flag, check if both acted → resolve turn Promise
- Modify `getGameStateForAgent()`: include `turn` and `awaitingAction` fields
- Replace inactivity checker: per-turn timeout (30s) → use NO_OP for non-responding agent
- Keep poll-based disconnect (60s no-poll → forfeit)

### 5. `apps/server/src/http-agent-handler.ts`
- Action response includes `turn` number
- No other endpoint changes

### 6. MCP tools (`packages/arena-mcp/`)
- No changes needed — they wrap HTTP, poll response naturally includes new fields

### 7. Agent SDK + existing agents
- Update default `pollIntervalMs` (cosmetic, works without changes)

### 8. `llm.txt` / docs
- Update to describe turn-based model

## Viewer Impact
- Viewer gets 1 frame per turn instead of 30Hz continuous
- Viewer already lerps between states, so this works
- Match speed depends on agent response time (fast agents = fast match)

## Edge Cases
- **One fast, one slow agent**: fast agent waits for slow agent
- **Agent disconnects**: 60s poll timeout → forfeit
- **Turn timeout**: 30s → use NO_OP and advance
- **Ring out mid-turn**: detected after each tick, match ends immediately
