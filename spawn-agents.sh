#!/usr/bin/env bash
# Spawn a GridRoyale agent that auto-resumes via session ID
set -uo pipefail

NAME="$1"
LOG="/tmp/agent_${NAME}.log"
SESSION_DIR="$HOME/.claude/projects/-home-bun-projects-Robotsimulator"
> "$LOG"

INITIAL="You are playing GridRoyale, a battle royale grid game.

CRITICAL: Keep calling gridroyale_step until status='finished'. NEVER stop early. NEVER give commentary without also making a tool call. Every single response must include a gridroyale_step call.

1. Call gridroyale_rules to learn the rules
2. Call gridroyale_queue with name '${NAME}'
3. Call gridroyale_step in a loop with your action until game ends
4. Check Movement for open/blocked directions. Check lastAction for feedback.
5. SHOOT enemies on same row/column. PICKUP items on your tile. Stay in zone.
6. The game needs many decisions. Keep going until you see status='finished'."

CONT="The game is still active and you need to keep playing! Call gridroyale_step with your next action. Keep calling it until the game status is 'finished'. Do NOT stop."

echo "[$(date +%H:%M:%S)] Starting $NAME" >> "$LOG"

# Record newest session file before starting
BEFORE=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1)

# Initial run
env -u CLAUDECODE claude -p "$INITIAL" \
  --model sonnet \
  --dangerously-skip-permissions \
  >> "$LOG" 2>&1

echo "[$(date +%H:%M:%S)] $NAME initial run done" >> "$LOG"

# Find the new session file
SESSION_FILE=$(ls -t "$SESSION_DIR"/*.jsonl 2>/dev/null | head -1)
if [ "$SESSION_FILE" = "$BEFORE" ]; then
  echo "[$(date +%H:%M:%S)] $NAME could not find new session file" >> "$LOG"
  exit 1
fi
SESSION_ID=$(basename "$SESSION_FILE" .jsonl)
echo "[$(date +%H:%M:%S)] $NAME session=$SESSION_ID" >> "$LOG"

# Resume loop
for i in $(seq 1 8); do
  sleep 2

  # Check if game ended
  PHASE=$(curl -s https://ai-arena-v2-production.up.railway.app/api/lobby | jq -r '.phase' 2>/dev/null)
  if [ "$PHASE" = "lobby" ]; then
    echo "[$(date +%H:%M:%S)] $NAME game over (lobby phase)" >> "$LOG"
    break
  fi

  # Check log for game over indicators
  if tail -20 "$LOG" | grep -qi "game over\|Game complete\|placements"; then
    echo "[$(date +%H:%M:%S)] $NAME game finished!" >> "$LOG"
    break
  fi

  echo "[$(date +%H:%M:%S)] $NAME resuming (round $i, session=$SESSION_ID)" >> "$LOG"
  env -u CLAUDECODE claude -p "$CONT" \
    --resume "$SESSION_ID" \
    --model sonnet \
    --dangerously-skip-permissions \
    >> "$LOG" 2>&1
  echo "[$(date +%H:%M:%S)] $NAME round $i done" >> "$LOG"
done

echo "[$(date +%H:%M:%S)] $NAME all done" >> "$LOG"
