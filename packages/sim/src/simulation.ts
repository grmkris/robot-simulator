import RAPIER from "@dimforge/rapier3d-compat";
import type {
  AgentAction,
  AgentId,
  MatchPhase,
  MatchResult,
  WorldState,
} from "@ai-arena/protocol";
import {
  TICK_DURATION_S,
  MATCH_DURATION_TICKS,
  RING_OUT_Y_THRESHOLD,
  ARENA_RADIUS,
  RING_OUT_DISTANCE_MARGIN,
  CHASSIS_DRIVE_FORCE,
  CHASSIS_MAX_SPEED,
} from "@ai-arena/protocol";
import { Arena } from "./arena.js";
import { RobotFactory, applyAction } from "./robot-factory.js";
import type { Robot } from "./robot-factory.js";
import { extractWorldState } from "./state-extractor.js";

const NO_OP: AgentAction = { leftArmTarget: 0, rightArmTarget: 0 };

/**
 * Callback to get an agent's action for a given tick.
 * Phase 1: synchronous function call.
 * Phase 2: reads from a pending action buffer.
 */
export type ActionProvider = (
  agentId: AgentId,
  state: WorldState
) => AgentAction;

/**
 * Core simulation class.
 * Owns the Rapier world, robots, arena, and all game logic.
 * Zero networking code — this is pure simulation.
 */
export class Simulation {
  private world!: RAPIER.World;
  private arena!: Arena;
  private robots!: [Robot, Robot];
  private tick = 0;
  private matchPhase: MatchPhase = "active";
  private lastActions: [AgentAction, AgentAction] = [
    { ...NO_OP },
    { ...NO_OP },
  ];
  private result: MatchResult | null = null;
  private tickHistory: Array<{ tick: number; actions: [AgentAction, AgentAction] }> = [];

  async init(): Promise<void> {
    // Gravity: 9.81 m/s^2 downward
    this.world = new RAPIER.World(new RAPIER.Vector3(0, -9.81, 0));

    // Create arena floor
    this.arena = new Arena(this.world);

    // Spawn robots on opposite sides (40% of arena radius)
    const factory = new RobotFactory(this.world);
    const spawnOffset = ARENA_RADIUS * 0.4;
    const robot0 = factory.create(0, -spawnOffset, 0);
    const robot1 = factory.create(1, spawnOffset, 0);
    this.robots = [robot0, robot1];
  }

  /**
   * Advance the simulation by one tick.
   * 1. Extract pre-step state
   * 2. Collect actions from provider
   * 3. Apply motor targets
   * 4. Step physics
   * 5. Extract post-step state
   * 6. Check win conditions
   */
  step(actionProvider: ActionProvider): WorldState {
    // 1. Build current state snapshot (before applying new actions)
    const preState = extractWorldState(
      this.tick,
      this.robots,
      this.lastActions,
      this.matchPhase
    );

    // 2. Collect actions from agents (only during active phase)
    if (this.matchPhase === "active") {
      const action0 = actionProvider(0, preState);
      const action1 = actionProvider(1, preState);
      this.lastActions = [action0, action1];

      // Record for replay
      this.tickHistory.push({
        tick: this.tick,
        actions: [{ ...action0 }, { ...action1 }],
      });

      // 3. Apply motor targets to physics joints
      applyAction(this.robots[0], action0);
      applyAction(this.robots[1], action1);

      // 4. Apply auto-approach drive force to each chassis
      this.applyDriveForce(this.robots[0], this.robots[1]);
      this.applyDriveForce(this.robots[1], this.robots[0]);
    }

    // 5. Step the physics world
    this.world.step();

    // 6. Increment tick
    this.tick++;

    // 7. Extract post-step state
    const postState = extractWorldState(
      this.tick,
      this.robots,
      this.lastActions,
      this.matchPhase
    );

    // 8. Check win conditions
    this.checkWinConditions(postState);

    return postState;
  }

  private checkWinConditions(state: WorldState): void {
    if (this.matchPhase !== "active") return;

    const [r0, r1] = state.robots;
    const r0Dead = !r0.isAlive || this.isOutOfArena(r0.chassis.position);
    const r1Dead = !r1.isAlive || this.isOutOfArena(r1.chassis.position);

    if (r0Dead && r1Dead) {
      this.endMatch(null, "ring_out");
    } else if (r0Dead) {
      this.endMatch(1, "ring_out");
    } else if (r1Dead) {
      this.endMatch(0, "ring_out");
    } else if (this.tick >= MATCH_DURATION_TICKS) {
      // Timeout: robot closest to center wins
      const d0 = Math.hypot(r0.chassis.position.x, r0.chassis.position.z);
      const d1 = Math.hypot(r1.chassis.position.x, r1.chassis.position.z);
      const winner: AgentId | null =
        d0 < d1 ? 0 : d1 < d0 ? 1 : null;
      this.endMatch(winner, "timeout");
    }
  }

  private isOutOfArena(pos: { x: number; y: number; z: number }): boolean {
    const distFromCenter = Math.hypot(pos.x, pos.z);
    return (
      pos.y < RING_OUT_Y_THRESHOLD ||
      distFromCenter > ARENA_RADIUS + RING_OUT_DISTANCE_MARGIN
    );
  }

  /**
   * Apply a constant drive force toward the opponent.
   * This is built-in sumo bot behavior — not agent-controlled.
   * Capped at CHASSIS_MAX_SPEED to prevent infinite acceleration.
   */
  private applyDriveForce(robot: Robot, opponent: Robot): void {
    const myPos = robot.chassis.translation();
    const oppPos = opponent.chassis.translation();

    // Direction toward opponent
    const dx = oppPos.x - myPos.x;
    const dz = oppPos.z - myPos.z;
    const dist = Math.hypot(dx, dz);

    if (dist < 0.01) return; // too close, skip

    // Normalize direction
    const nx = dx / dist;
    const nz = dz / dist;

    // Check current velocity in drive direction
    const vel = robot.chassis.linvel();
    const speedToward = vel.x * nx + vel.z * nz;

    // Only apply force if below max speed
    if (speedToward < CHASSIS_MAX_SPEED) {
      robot.chassis.addForce(
        new RAPIER.Vector3(
          nx * CHASSIS_DRIVE_FORCE,
          0,
          nz * CHASSIS_DRIVE_FORCE
        ),
        true
      );
    }
  }

  private endMatch(
    winner: AgentId | null,
    reason: MatchResult["reason"]
  ): void {
    this.matchPhase = "finished";
    this.result = { winner, reason, finalTick: this.tick };
  }

  // ── Accessors ──

  get currentTick(): number {
    return this.tick;
  }
  get phase(): MatchPhase {
    return this.matchPhase;
  }
  get matchResult(): MatchResult | null {
    return this.result;
  }
  get history(): ReadonlyArray<{
    tick: number;
    actions: [AgentAction, AgentAction];
  }> {
    return this.tickHistory;
  }

  /** Get current world state snapshot */
  getWorldState(): WorldState {
    return extractWorldState(
      this.tick,
      this.robots,
      this.lastActions,
      this.matchPhase
    );
  }

  /** Clean up Rapier resources */
  destroy(): void {
    this.world.free();
  }
}
