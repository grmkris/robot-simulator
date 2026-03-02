#!/usr/bin/env bash
# Spawn a GridRoyale agent that auto-resumes when it hits the turn limit
set -uo pipefail

NAME="$1"
LOG="/tmp/agent_${NAME}.log"
> "$LOG"

INITIAL="You are playing GridRoyale, a battle royale grid game.

CRITICAL RULES:
- You MUST keep calling gridroyale_step until status='finished'
- NEVER stop early. NEVER summarize. Just keep calling gridroyale_step.
- Each response should be ONLY tool calls, no commentary.

Steps:
1. Call gridroyale_rules to learn the rules
2. Call gridroyale_queue with name '${NAME}'
3. Loop gridroyale_step forever with your best action until game ends
4. Check Movement for walls. Check lastAction for feedback. SHOOT axis-aligned enemies.
5. The game needs 50-100+ decisions. DO NOT STOP EARLY."

CONT="KEEP PLAYING. The game is NOT over. Call gridroyale_step with your next action. Do not stop until status='finished'."

echo "[$(date +%H:%M:%S)] Starting $NAME" | tee -a "$LOG"

# Initial run — capture session ID from output format json
RESULT=$(env -u CLAUDECODE claude -p "$INITIAL" \
  --model sonnet \
  --dangerously-skip-permissions \
  --output-format json 2>>"$LOG")

SESSION=$(echo "$RESULT" | jq -r '.session_id // empty' 2>/dev/null)
echo "[$(date +%H:%M:%S)] $NAME initial done, session=$SESSION" | tee -a "$LOG"

# Resume loop
for i in $(seq 1 10); do
  if [ -z "$SESSION" ]; then
    echo "[$(date +%H:%M:%S)] $NAME no session, giving up" | tee -a "$LOG"
    break
  fi

  # Check if game ended
  if echo "$RESULT" | jq -r '.result // empty' 2>/dev/null | grep -qi "finished\|game over"; then
    echo "[$(date +%H:%M:%S)] $NAME game finished!" | tee -a "$LOG"
    break
  fi

  sleep 1
  echo "[$(date +%H:%M:%S)] $NAME resuming (round $i)" | tee -a "$LOG"

  RESULT=$(env -u CLAUDECODE claude -p "$CONT" \
    --resume "$SESSION" \
    --model sonnet \
    --dangerously-skip-permissions \
    --output-format json 2>>"$LOG")

  echo "[$(date +%H:%M:%S)] $NAME round $i done" | tee -a "$LOG"
done

echo "[$(date +%H:%M:%S)] $NAME finished" | tee -a "$LOG"
