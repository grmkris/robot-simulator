/**
 * Misha - Aggressive arena fighter
 * Smart edge-aware strategy: charge when safe, hold position when near edge.
 */

const SERVER = "https://authentic-simplicity-production-d41b.up.railway.app";

async function join(name: string): Promise<{ token: string }> {
  const res = await fetch(`${SERVER}/api/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Join failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function pollState(token: string): Promise<any> {
  for (let retry = 0; retry < 3; retry++) {
    try {
      const res = await fetch(`${SERVER}/api/game-state`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) return { status: "finished", winner: null, reason: "session_expired" };
      if (res.status === 502 || res.status === 503) {
        await Bun.sleep(500);
        continue;
      }
      if (!res.ok) throw new Error(`Poll failed: ${res.status}`);
      return res.json();
    } catch (e: any) {
      if (retry === 2) throw e;
      await Bun.sleep(500);
    }
  }
}

async function act(token: string, action: any): Promise<void> {
  await fetch(`${SERVER}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(action),
  });
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function aggressiveDecision(tick: number, tactical: any) {
  const dist = tactical.distanceToOpponent;
  const myDist = tactical.myDistFromCenter;
  const oppDist = tactical.opponentDistFromCenter;
  const angleToOpp = tactical.angleToOpponent;
  const myFacing = tactical.myFacingAngle;
  const cooldown = tactical.myCooldownS;
  const incoming = tactical.incomingProjectiles;

  const angleDiff = normalizeAngle(angleToOpp - myFacing);
  const turnRate = Math.max(-1, Math.min(1, angleDiff * 3));
  const aligned = Math.abs(angleDiff) < 0.3;
  const roughlyAligned = Math.abs(angleDiff) < 0.6;

  const armPhase = tick * 0.4;
  let leftArm = Math.sin(armPhase);
  let rightArm = Math.sin(armPhase + Math.PI);
  let drive = 0;
  let shoot = false;
  let thought = "";

  const opponentTowardCenter = oppDist < myDist;
  const edgeRoom = 10 - myDist;

  // === CRITICAL EDGE DANGER ===
  if (edgeRoom < 2) {
    drive = -1.0;
    thought = "REVERSING FROM EDGE!";
    leftArm = -0.5;
    rightArm = -0.5;
  }
  // === EDGE CAUTION ===
  else if (edgeRoom < 4 && !opponentTowardCenter) {
    drive = -0.5;
    shoot = cooldown <= 0 && aligned;
    thought = shoot ? "EDGE SHOT!" : "HOLDING EDGE!";
  }
  // === CLOSE COMBAT ===
  else if (dist < 2.5) {
    drive = aligned ? 0.7 : 0.3;
    shoot = cooldown <= 0;
    thought = "EAT FISTS!";
    leftArm = Math.sin(tick * 0.6);
    rightArm = Math.sin(tick * 0.6 + Math.PI);
    if (!opponentTowardCenter && edgeRoom > 4) {
      drive = 1.0;
      thought = "PUSH OUT!";
    }
  }
  // === MID RANGE ===
  else if (dist < 5) {
    const driveFactor = Math.min(0.8, (dist - 1.5) / 4);
    drive = aligned ? driveFactor : driveFactor * 0.5;
    shoot = cooldown <= 0 && aligned;
    thought = shoot ? "FIRE!" : "CLOSING IN!";
    if (!opponentTowardCenter && edgeRoom < 5) {
      drive = Math.min(drive, 0.2);
      thought = "CAREFUL APPROACH!";
    }
  }
  // === LONG RANGE ===
  else {
    drive = roughlyAligned ? 0.7 : 0.3;
    shoot = cooldown <= 0 && aligned && dist < 8;
    thought = "CHARGING!";
    if (!opponentTowardCenter && edgeRoom < 5) {
      drive = 0;
      thought = "CIRCLING!";
    }
  }

  // Opponent near edge — go for the kill
  if (oppDist > 7 && myDist < 6 && aligned) {
    drive = 1.0;
    shoot = cooldown <= 0;
    thought = "RING OUT TIME!";
  }

  return {
    leftArmTarget: leftArm,
    rightArmTarget: rightArm,
    driveForce: drive,
    turnRate,
    shoot,
    thought,
  };
}

async function main() {
  console.log("=== MISHA - AGGRESSIVE FIGHTER ===");
  console.log(`Server: ${SERVER}`);
  console.log("Watch: https://arena-viewer-production.up.railway.app\n");

  let me: { token: string };
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      me = await join("Misha");
      break;
    } catch {
      if (attempt === 0) console.log("Waiting for open slot...");
      if (attempt % 10 === 0 && attempt > 0) console.log(`Still waiting... (${attempt}s)`);
      await Bun.sleep(1000);
    }
  }
  if (!me!) throw new Error("Could not join after 120 attempts");
  console.log("Joined! Waiting for match...");

  let state: any;
  let myAgentId: number | null = null;
  while (true) {
    state = await pollState(me.token);
    if (state.status === "active") {
      if (state.you !== undefined) myAgentId = state.you;
      break;
    }
    if (state.status === "finished") { console.log("Match ended early:", state.reason); return; }
    if (state.status === "countdown") console.log("Countdown...");
    await Bun.sleep(200);
  }
  console.log("\nFIGHT!\n");

  let tick = 0;
  while (true) {
    try {
      state = await pollState(me.token);
      if (state.status === "finished") {
        console.log("\n=== MATCH OVER ===");
        const won = myAgentId !== null ? state.winner === myAgentId : null;
        console.log(`Winner: ${won === true ? "MISHA WINS!" : won === false ? "Opponent wins" : state.winner ?? "Draw"}`);
        console.log(`Reason: ${state.reason}`);
        break;
      }
      if (state.status === "active" && state.tactical) {
        if (state.you !== undefined) myAgentId = state.you;
        tick++;
        const decision = aggressiveDecision(tick, state.tactical);
        if (tick % 15 === 0) {
          const t = state.tactical;
          console.log(
            `[${t.timeRemainingS.toFixed(0)}s] Dist:${t.distanceToOpponent.toFixed(1)}m ` +
            `Me:${t.myDistFromCenter.toFixed(1)}m Opp:${t.opponentDistFromCenter.toFixed(1)}m ` +
            `| ${decision.thought}`
          );
        }
        await act(me.token, decision);
      }
    } catch (err: any) {
      console.error("Error:", err.message);
    }
    await Bun.sleep(50);
  }
}

main().then(() => console.log("Done.")).catch((e) => console.error("FATAL:", e));
