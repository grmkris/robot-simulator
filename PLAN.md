# Mind Games: AI Arena Upgrade Plan

## Overview
Transform from scripted 60Hz bots into an AI-powered arena where LLM agents make real decisions,
emit visible thoughts, and try to outwit each other — all while spectators watch the inner monologue in real-time.

Two core changes:
1. **Slow Real-Time (2Hz decisions)** — physics runs at 60Hz, agents decide every 500ms, last action persists
2. **Mind Games** — agents return thoughts (public + private) alongside actions, visible in viewer

---

## Step 1: Protocol Changes (`packages/protocol`)

### `src/constants.ts` — Add decision cadence constants
```
AGENT_DECISION_RATE = 2          // Hz
AGENT_DECISION_INTERVAL = 30     // ticks between decisions (60/2)
AGENT_DECISION_DEADLINE_MS = 4000 // hard timeout per window
MATCH_DURATION_S = 60             // longer matches for slower decisions
```

### `src/types.ts` — Add thought types + tactical context
```typescript
// New: tactical summary (pre-computed for LLMs)
interface TacticalContext {
  distanceToOpponent: number;
  myDistFromCenter: number;
  opponentDistFromCenter: number;
  closingSpeed: number;
  mySpeed: number;
  opponentSpeed: number;
  timeRemainingS: number;
  round: number;
}

// Extend AgentAction with optional thoughts
interface AgentAction {
  leftArmTarget: number;
  rightArmTarget: number;
  thought?: string;         // visible to opponent AND spectators
  privateThought?: string;  // visible to spectators ONLY
}
```

### `src/messages.ts` — New decision_window message
```typescript
// Server -> Agent: sent every 500ms instead of every tick
DecisionWindowMessage {
  type: "decision_window"
  round: number
  tick: number
  state: WorldState
  tactical: TacticalContext
  yourLastAction: AgentAction
  opponentLastThought: string | null   // the opponent's public thought
  deadline_ms: number
}

// Agent -> Server: response with thoughts
ActionMessage {
  type: "action"
  round: number   // changed from tick to round
  action: AgentAction  // now includes thought + privateThought
}
```

### `src/schemas.ts` — Zod schemas for new types

---

## Step 2: Server Match Manager (`apps/server/src/match-manager.ts`)

### Action Persistence
Replace consume-and-null pattern with persist pattern:
```typescript
// OLD: agent.pendingAction consumed, NO_OP if null
// NEW: agent.confirmedAction persists until updated

interface ConnectedAgent {
  // ...existing fields...
  confirmedAction: AgentAction;     // NEW: persists between decisions
  lastDecisionRound: number;        // NEW: track which round was answered
  consecutiveTimeouts: number;      // NEW: forfeit after 5 timeouts
  lastThought: string | null;       // NEW: public thought for opponent to see
  lastPrivateThought: string | null; // NEW: private thought for spectators
}
```

### Decision Cadence (2Hz)
Replace per-tick broadcasts to agents with a 500ms interval:
```
- Stop sending tick messages to agents every frame
- Start a setInterval(500ms) that sends decision_window messages
- Include tactical context (pre-computed distances, speeds, time remaining)
- Include opponent's last public thought
- Apply deadline check: if agent misses 5 consecutive windows → forfeit
```

### Spectator Broadcasts — Add thoughts
Include agent thoughts in spectator state messages:
```typescript
// In broadcastToSpectators:
{
  type: "state",
  tick, time, robots, matchPhase,
  // NEW fields:
  thoughts: {
    A: { thought: "...", privateThought: "..." },
    B: { thought: "...", privateThought: "..." }
  },
  round: currentDecisionRound
}
```

### Action Receipt
```typescript
receiveAction(agentId, round, action):
  - Reject if round is too old (< currentRound - 1)
  - Store action.thought as agent.lastThought
  - Store action.privateThought as agent.lastPrivateThought
  - Update agent.confirmedAction (persists until next decision)
  - Reset agent.consecutiveTimeouts
```

---

## Step 3: Agent SDK (`packages/agent-sdk/src/client.ts`)

### Async Brain Support
```typescript
// OLD: synchronous only
type AgentBrain = (agentId, state) => AgentAction;

// NEW: async allowed, receives tactical context + opponent thought
type AgentBrain = (
  agentId: AgentId,
  state: WorldState,
  context: {
    tactical: TacticalContext;
    currentAction: AgentAction;
    opponentThought: string | null;
    round: number;
  }
) => AgentAction | Promise<AgentAction>;
```

### Handle decision_window message type
```typescript
case "decision_window":
  const result = brain(agentId, state, context);
  // Support both sync and async
  Promise.resolve(result).then((action) => {
    ws.send(JSON.stringify({ type: "action", round, action }));
  });
```

### Backward Compatibility
Keep handling "tick" messages for old-style agents (they'll work but with NO_OP persistence).

---

## Step 4: Claude-Powered Agent (`agents/claude-agent/`)

### New package: `@ai-arena/claude-agent`

**Dependencies:** `@anthropic-ai/sdk`, `@ai-arena/agent-sdk`, `@ai-arena/protocol`

### Brain function (async):
```typescript
async function claudeBrain(agentId, state, context): Promise<AgentAction> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",  // fast + cheap for game decisions
    max_tokens: 256,
    system: FIGHTER_SYSTEM_PROMPT,
    messages: [{ role: "user", content: formatGameState(context) }],
  });
  // Parse structured JSON from response
  return { leftArmTarget, rightArmTarget, thought, privateThought };
}
```

### System prompt: personality + game rules + tactical advice
```
You are a robot fighter in an arena. You control two arms [-1, 1].
You auto-charge toward your opponent. Your goal: push them off the edge.

Respond with JSON: { left, right, thought, private }
- left/right: arm angles (-1=back, 1=forward)
- thought: what you say (opponent sees this!)
- private: your real strategy (only spectators see)

BE STRATEGIC: your thought is visible to your opponent.
You can lie, bluff, intimidate, or be honest.
```

### Use Haiku for speed (~200ms), structured output for reliability

---

## Step 5: Viewer Updates (`apps/viewer/`)

### `src/lib/types.ts` — Add thought fields
```typescript
interface ViewerStateMessage {
  // ...existing fields...
  thoughts?: {
    A: { thought: string | null; privateThought: string | null };
    B: { thought: string | null; privateThought: string | null };
  };
  round?: number;
}
```

### `src/lib/store.ts` — Store thoughts
```typescript
interface ArenaStore {
  // ...existing fields...
  thoughts: {
    A: { thought: string | null; privateThought: string | null };
    B: { thought: string | null; privateThought: string | null };
  } | null;
  round: number;
}
```

### New component: `src/components/ThoughtBubbles.tsx`
Two speech bubble panels flanking the 3D arena:
- Left side (blue): Robot A's thoughts
- Right side (red): Robot B's thoughts
- Public thought shown in quotes
- Private thought shown in italics below (labeled "inner monologue")
- Animate on change (fade in/slide)
- Show "thinking..." when waiting for decision

### `src/components/MatchHUD.tsx` — Add round counter + agent names
- Show decision round number
- Show agent names (from join message, forwarded in state)

### Update `useMatchSocket.ts` — Parse new thought fields from state messages

---

## Step 6: Replay System Updates

### `apps/server/src/replay-store.ts`
Add thoughts to ViewerFrame:
```typescript
interface ViewerFrame {
  // ...existing fields...
  thoughts?: {
    A: { thought: string | null; privateThought: string | null };
    B: { thought: string | null; privateThought: string | null };
  };
  round?: number;
}
```

### Replay player — show thoughts during playback
ThoughtBubbles component works in replay mode too (reads from frame data).

---

## Step 7: WebSocket Handler Updates (`apps/server/src/ws-handler.ts`)

### Forward agent names to spectators
When agents join, broadcast their names so the viewer can display them.

### Validate new message schemas
Update ClientMessageSchema to accept round-based actions with thoughts.

---

## File Change Summary

| File | Change |
|------|--------|
| `packages/protocol/src/constants.ts` | Add decision cadence constants |
| `packages/protocol/src/types.ts` | Add TacticalContext, extend AgentAction with thoughts |
| `packages/protocol/src/messages.ts` | Add DecisionWindowMessage, update ActionMessage |
| `packages/protocol/src/schemas.ts` | Add Zod schemas for new types |
| `apps/server/src/match-manager.ts` | Action persistence, 2Hz cadence, thought tracking, tactical context |
| `apps/server/src/ws-handler.ts` | Handle round-based actions, forward agent names |
| `apps/server/src/replay-store.ts` | Add thoughts to ViewerFrame |
| `packages/agent-sdk/src/client.ts` | Async brain, decision_window handling |
| `agents/claude-agent/package.json` | NEW: Claude-powered agent package |
| `agents/claude-agent/src/index.ts` | NEW: Claude brain function |
| `agents/claude-agent/src/main.ts` | NEW: Entry point |
| `agents/claude-agent/tsconfig.json` | NEW: TypeScript config |
| `agents/heuristic-agent/src/index.ts` | Adapt to new brain signature (add thoughts) |
| `agents/random-agent/src/index.ts` | Adapt to new brain signature |
| `agents/aggressive-agent/src/index.ts` | Adapt to new brain signature |
| `apps/viewer/src/lib/types.ts` | Add thoughts to ViewerStateMessage |
| `apps/viewer/src/lib/store.ts` | Store thoughts in Zustand |
| `apps/viewer/src/hooks/useMatchSocket.ts` | Parse thoughts from state |
| `apps/viewer/src/components/ThoughtBubbles.tsx` | NEW: Speech bubble panels |
| `apps/viewer/src/components/MatchHUD.tsx` | Show round, agent names |
| `apps/viewer/src/app/replays/[id]/page.tsx` | Show thoughts in replay |
| `apps/server/Dockerfile` | Add claude-agent to COPY |

## Build Order
1. Protocol types + schemas (foundation)
2. Server match-manager (core logic)
3. Agent SDK (async brain)
4. Update existing agents (adapt signatures)
5. Claude agent (new package)
6. Viewer (thoughts display)
7. Replay system (thoughts in frames)
8. Deploy + test
