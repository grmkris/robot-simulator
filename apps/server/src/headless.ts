/**
 * Phase 1 Entry Point — Headless Simulation Runner
 *
 * Runs a complete match between two scripted agents with no networking.
 * Validates that the physics simulation works end-to-end.
 */
import { initPhysics, Simulation, GameLoop } from "@ai-arena/sim";
import { randomAgent } from "@ai-arena/random-agent";
import { heuristicAgent } from "@ai-arena/heuristic-agent";
import type { AgentId, WorldState } from "@ai-arena/protocol";
import { TICK_RATE } from "@ai-arena/protocol";

async function main() {
  console.log("=== AI Actuator Arena — Headless Mode ===\n");

  console.log("Initializing Rapier3D WASM...");
  await initPhysics();

  console.log("Creating simulation...");
  const sim = new Simulation();
  await sim.init();

  const actionProvider = (agentId: AgentId, state: WorldState) => {
    return agentId === 0
      ? heuristicAgent(agentId, state)
      : randomAgent(agentId, state);
  };

  const loop = new GameLoop(sim, actionProvider, {
    onTick: (state) => {
      // Log every second
      if (state.tick % TICK_RATE === 0) {
        const r0 = state.robots[0];
        const r1 = state.robots[1];
        const r0Dist = Math.hypot(
          r0.chassis.position.x,
          r0.chassis.position.z
        ).toFixed(2);
        const r1Dist = Math.hypot(
          r1.chassis.position.x,
          r1.chassis.position.z
        ).toFixed(2);

        console.log(
          `[T=${String(state.tick).padStart(5)}] ` +
            `R0(${r0.chassis.position.x.toFixed(2)}, ${r0.chassis.position.z.toFixed(2)}) dist=${r0Dist} | ` +
            `R1(${r1.chassis.position.x.toFixed(2)}, ${r1.chassis.position.z.toFixed(2)}) dist=${r1Dist} | ` +
            `Arms: L[${r0.leftArm.currentAngle.toFixed(2)}] R[${r0.rightArm.currentAngle.toFixed(2)}]`
        );
      }
    },
    onMatchEnd: (result) => {
      console.log("\n=== MATCH RESULT ===");
      console.log(
        `Winner: ${result.winner !== null ? `Robot ${result.winner}` : "DRAW"}`
      );
      console.log(`Reason: ${result.reason}`);
      console.log(`Final tick: ${result.finalTick}`);
      console.log(`Duration: ${(result.finalTick / TICK_RATE).toFixed(1)}s`);
      console.log("====================\n");

      sim.destroy();
      process.exit(0);
    },
  });

  console.log("Starting match: HeuristicAgent (R0) vs RandomAgent (R1)...\n");
  loop.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
