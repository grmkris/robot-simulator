// ═══════════════════════════════════════════════
// Game Manager — Orchestrates lobby, game, and results
// ═══════════════════════════════════════════════

import {
  SIM_TICK_MS,
  DECISION_INTERVAL,
  DECISION_TIMEOUT_MS,
  DECISION_WAIT_TIMEOUT_MS,
  VIEWER_TICK_INTERVAL,
  QUEUE_INACTIVITY_TIMEOUT_MS,
} from "../shared/constants.js";
import type {
  GameState,
  Intent,
  Observation,
  GameResult,
} from "../shared/types.js";
import type { ViewerStateMessage, ViewerLobbyMessage, ViewerGameOverMessage } from "../shared/messages.js";
import { createGameState, tickReducer, extractGameResult } from "../engine/tick-reducer.js";
import { buildObservation } from "../engine/fog.js";
import { SeededRNG } from "../engine/rng.js";
import { SessionManager } from "./session.js";
import { Lobby, type LobbyPlayer } from "./lobby.js";
import { computeMultiplayerElo } from "../match/elo.js";
import { games, gamePlayers, intents as intentsTable, agentStats } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import type { ServerWebSocket } from "bun";

// ── Types ──

export interface StepWaiter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  resolve: (obs: any) => void;
  playerId: string;
}

export interface SSEClient {
  playerId: string;
  controller: ReadableStreamDefaultController;
}

export interface GameEvent {
  type: "lobby" | "observation" | "game_start" | "game_over";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export type GameEventCallback = (event: GameEvent) => void;

// ── Match ID ──

function generateMatchId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toISOString().slice(11, 19).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 6);
  return `match_${date}_${time}_${rand}`;
}

// ── GameManager ──

export class GameManager {
  // ── Database ──
  private db: AppDatabase;

  // ── Sessions ──
  readonly sessions = new SessionManager();

  // ── Lobby ──
  private lobby = new Lobby();

  // ── Active Game ──
  private state: GameState | null = null;
  private rng: SeededRNG | null = null;
  private matchId: string | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private pendingIntents = new Map<string, Intent>();
  private intentLog: Array<{ tick: number; playerId: string; intent: Intent }> = [];
  private gameSeed: number = 0;
  private lastResult: GameResult | null = null;
  private gameStartTime: number = 0;

  // ── br.step() waiters ──
  private stepWaiters: StepWaiter[] = [];

  // ── SSE clients ──
  private sseClients: SSEClient[] = [];

  // ── MCP push observers ──
  private mcpObservers = new Map<string, GameEventCallback>();

  // ── Turn-based decision wait ──
  private submittedIntents = new Set<string>();
  private decisionTimeout: ReturnType<typeof setTimeout> | null = null;
  private waitingForDecisions = false;
  private consecutiveEmptyDecisions = 0; // track zombie games

  // ── Spectators (WebSocket) ──
  private spectators = new Set<ServerWebSocket<unknown>>();

  // ── Cleanup timer ──
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(db: AppDatabase) {
    this.db = db;
    // Wire up lobby events
    this.lobby.setOnStart((players) => this.startGame(players));
    this.lobby.setOnChange(() => this.broadcastLobbyState());

    // Periodic cleanup of stale sessions
    this.cleanupTimer = setInterval(() => {
      this.sessions.removeStale(QUEUE_INACTIVITY_TIMEOUT_MS);
    }, 10_000);
  }

  // ══════════════════════════════════════════
  // Public API — Queue/Join
  // ══════════════════════════════════════════

  /** Queue a player into the lobby */
  queue(name: string): { token: string; playerId: string } | { error: string } {
    // Check if game is active — can still join lobby for next game
    if (this.sessions.isNameTaken(name)) {
      return { error: "Name already taken" };
    }

    const session = this.sessions.create(name);
    if (!session) {
      return { error: "Failed to create session" };
    }

    const lobbyPlayer: LobbyPlayer = {
      playerId: session.playerId,
      name: session.name,
      token: session.token,
      joinedAt: session.joinedAt,
    };

    const added = this.lobby.addPlayer(lobbyPlayer);
    if (!added) {
      this.sessions.remove(session.token);
      return { error: "Lobby is full or game is starting" };
    }

    return { token: session.token, playerId: session.playerId };
  }

  /** Leave the lobby or game */
  leave(token: string): boolean {
    const session = this.sessions.getByToken(token);
    if (!session) return false;

    // If in lobby, remove from lobby
    this.lobby.removePlayer(token);

    // If in game, mark as dead (forfeit)
    if (session.matchId && this.state) {
      const player = this.state.players.get(session.playerId);
      if (player && player.alive) {
        const updated = { ...player, alive: false, hp: 0, deathTick: this.state.tick };
        this.state.players.set(session.playerId, updated);
      }
      // If waiting for decisions, leaving player reduces alive count — check if all remaining submitted
      if (this.waitingForDecisions) {
        this.checkAllSubmitted();
      }
    }

    this.sessions.remove(token);
    return true;
  }

  // ══════════════════════════════════════════
  // Public API — Observe / Act / Step
  // ══════════════════════════════════════════

  /** Get current observation for a player */
  observe(token: string): Observation | { status: string; countdown?: number | null; players?: string[]; result?: GameResult | null } | null {
    const session = this.sessions.getByToken(token);
    if (!session) return null;

    // If in active game
    if (this.state && this.matchId && this.state.phase === "active") {
      return buildObservation(this.state, session.playerId, this.matchId);
    }

    // Game finished (check before lobby — matchId gets cleared on game end)
    if (this.lastResult) {
      return { status: "finished", result: this.lastResult };
    }

    // If in lobby / waiting
    return {
      status: this.lobby.phase === "waiting" ? "waiting" : "countdown",
      countdown: this.lobby.countdown,
      players: this.lobby.getPlayers().map((p) => p.name),
    };
  }

  /** Submit an action intent */
  act(token: string, action: { t: string; dir?: string }): { ok: boolean; error?: string } {
    const session = this.sessions.getByToken(token);
    if (!session) return { ok: false, error: "Invalid token" };
    if (!session.matchId || !this.state) return { ok: false, error: "Not in a game" };

    const player = this.state.players.get(session.playerId);
    if (!player || !player.alive) return { ok: false, error: "Player is dead" };

    const intent: Intent = {
      action: action.t as Intent["action"],
      dir: action.dir as Intent["dir"],
    };

    this.pendingIntents.set(session.playerId, intent);
    this.submittedIntents.add(session.playerId);

    // Check if all alive players have submitted — if so, resume ticking
    if (this.waitingForDecisions) {
      this.checkAllSubmitted();
    }

    return { ok: true };
  }

  /**
   * br.step() — Universal loop: submit optional action, wait for next decision tick,
   * return observation. This blocks until the next decision tick fires.
   */
  async step(
    token: string,
    action?: { t: string; dir?: string },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const session = this.sessions.getByToken(token);
    if (!session) return null;

    // If game is finished (check before lobby — matchId gets cleared on game end)
    if (this.lastResult && (!this.state || this.state.phase === "finished")) {
      return {
        status: "finished",
        result: this.lastResult,
      };
    }

    // If in lobby, return lobby state immediately (no blocking)
    if (!session.matchId || !this.state || this.state.phase !== "active") {
      return {
        status: this.lobby.phase === "waiting" ? "waiting" : "countdown",
        countdown: this.lobby.countdown,
        players: this.lobby.getPlayers().map((p) => p.name),
      };
    }

    // Submit action if provided
    if (action) {
      this.act(token, action);
    }

    // Wait for the next decision tick
    return new Promise((resolve) => {
      const waiter: StepWaiter = { resolve, playerId: session.playerId };
      this.stepWaiters.push(waiter);

      // Timeout — don't block forever
      setTimeout(() => {
        const idx = this.stepWaiters.indexOf(waiter);
        if (idx !== -1) {
          this.stepWaiters.splice(idx, 1);
          // Return current observation even on timeout
          if (this.state && this.matchId) {
            resolve(buildObservation(this.state, session.playerId, this.matchId));
          } else {
            resolve(null);
          }
        }
      }, DECISION_TIMEOUT_MS);
    });
  }

  // ══════════════════════════════════════════
  // Public API — Game State (for viewers)
  // ══════════════════════════════════════════

  /** Get the full game state for the viewer */
  getViewerState(): ViewerStateMessage | null {
    if (!this.state) return null;

    const players = Array.from(this.state.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      hp: p.hp,
      shield: p.shield,
      stamina: p.stamina,
      ammo: p.ammo,
      facing: p.facing,
      alive: p.alive,
      kills: p.kills,
    }));

    return {
      type: "state" as const,
      tick: this.state.tick,
      phase: this.state.phase,
      players,
      projectiles: this.state.projectiles.map((p) => ({
        id: p.id,
        ownerId: p.ownerId,
        x: p.x,
        y: p.y,
        dir: p.dir,
      })),
      pickups: this.state.pickups.map((p) => ({
        id: p.id,
        kind: p.kind,
        x: p.x,
        y: p.y,
      })),
      zone: {
        cx: this.state.zone.cx,
        cy: this.state.zone.cy,
        r: this.state.zone.r,
      },
      killFeed: this.state.events
        .filter((e) => e.type === "KILL")
        .slice(-10)
        .map((e) => {
          const d = e.data as Record<string, unknown>;
          const victimPlayer = this.state!.players.get(d.victimId as string);
          const killerPlayer = d.killerId ? this.state!.players.get(d.killerId as string) : null;
          return {
            tick: e.tick,
            killerId: (d.killerId as string) ?? null,
            victimId: d.victimId as string,
            victimName: victimPlayer?.name ?? "unknown",
            killerName: killerPlayer?.name ?? null,
            weapon: (d.weapon as "projectile" | "zone") ?? "zone",
          };
        }),
      playersAlive: Array.from(this.state.players.values()).filter((p) => p.alive).length,
    };
  }

  /** Get lobby state */
  getLobbyState(): ViewerLobbyMessage {
    return {
      type: "lobby" as const,
      players: this.lobby.getPlayers().map((p) => ({
        name: p.name,
        ready: true,
      })),
      countdown: this.lobby.countdown,
      phase: this.lobby.phase === "starting" ? "countdown" : this.lobby.phase === "countdown" ? "countdown" : "lobby",
    };
  }

  /** Get current match ID */
  getMatchId(): string | null {
    return this.matchId;
  }

  /** Get last game result */
  getLastResult(): GameResult | null {
    return this.lastResult;
  }

  /** Get intent log for replay */
  getIntentLog(): Array<{ tick: number; playerId: string; intent: Intent }> {
    return this.intentLog;
  }

  /** Get game seed */
  getSeed(): number {
    return this.gameSeed;
  }

  /** Check if a game is currently active */
  get isGameActive(): boolean {
    return this.state !== null && this.state.phase === "active";
  }

  /** Get the current game phase */
  get gamePhase(): string {
    if (this.state) return this.state.phase;
    return this.lobby.phase;
  }

  // ══════════════════════════════════════════
  // Spectators (WebSocket)
  // ══════════════════════════════════════════

  addSpectator(ws: ServerWebSocket<unknown>): void {
    this.spectators.add(ws);

    // Send current state immediately
    if (this.state) {
      const msg = this.getViewerState();
      if (msg) {
        ws.send(JSON.stringify(msg));
      }
    } else {
      ws.send(JSON.stringify(this.getLobbyState()));
    }
  }

  removeSpectator(ws: ServerWebSocket<unknown>): void {
    this.spectators.delete(ws);
  }

  get spectatorCount(): number {
    return this.spectators.size;
  }

  // ══════════════════════════════════════════
  // SSE Client Management
  // ══════════════════════════════════════════

  registerSSEClient(playerId: string, controller: ReadableStreamDefaultController): void {
    this.sseClients.push({ playerId, controller });
  }

  unregisterSSEClient(playerId: string, controller: ReadableStreamDefaultController): void {
    this.sseClients = this.sseClients.filter(
      (c) => !(c.playerId === playerId && c.controller === controller),
    );
  }

  // ══════════════════════════════════════════
  // MCP Push Observers
  // ══════════════════════════════════════════

  /** Register a callback that receives game events for a specific player */
  registerObserver(playerId: string, callback: GameEventCallback): void {
    this.mcpObservers.set(playerId, callback);
    console.log(`[GM] Observer registered for player ${playerId.slice(0, 8)}…`);
  }

  /** Unregister the observer for a player */
  unregisterObserver(playerId: string): void {
    this.mcpObservers.delete(playerId);
    console.log(`[GM] Observer unregistered for player ${playerId.slice(0, 8)}…`);
  }

  // ══════════════════════════════════════════
  // Internal — Game Lifecycle
  // ══════════════════════════════════════════

  private startGame(lobbyPlayers: LobbyPlayer[]): void {
    this.gameStartTime = Date.now();
    this.gameSeed = Date.now() ^ Math.floor(Math.random() * 0x7fffffff);
    this.rng = new SeededRNG(this.gameSeed);
    this.matchId = generateMatchId();
    this.intentLog = [];
    this.lastResult = null;
    this.pendingIntents.clear();
    this.stepWaiters = [];
    this.submittedIntents.clear();
    this.waitingForDecisions = false;
    this.consecutiveEmptyDecisions = 0;
    if (this.decisionTimeout) { clearTimeout(this.decisionTimeout); this.decisionTimeout = null; }

    const playerInfos = lobbyPlayers.map((p) => ({
      id: p.playerId,
      name: p.name,
    }));

    this.state = createGameState(this.gameSeed, playerInfos);

    // Assign match to all sessions
    for (const lp of lobbyPlayers) {
      this.sessions.assignMatch(lp.token, this.matchId);
    }

    console.log(`[Game] Started match ${this.matchId} with ${lobbyPlayers.length} players (seed: ${this.gameSeed})`);

    // Start the tick loop
    this.tickTimer = setInterval(() => this.tick(), SIM_TICK_MS);

    // Broadcast initial state to spectators
    this.broadcastViewerState();

    // Push game_start to MCP observers
    this.pushMcpGameStart();

    // Pause immediately for first turn — give agents time to submit their first action
    this.pauseForDecisions();
  }

  private tick(): void {
    if (!this.state || !this.rng || this.state.phase !== "active") return;

    const isDecisionTick = (this.state.tick + 1) % DECISION_INTERVAL === 0;

    // At decision boundary: pause and wait for all players to submit
    if (isDecisionTick && !this.waitingForDecisions) {
      this.pauseForDecisions();
      return;
    }

    // Record intents before tick
    if (isDecisionTick) {
      for (const [playerId, intent] of this.pendingIntents) {
        this.intentLog.push({
          tick: this.state.tick + 1,
          playerId,
          intent: { ...intent },
        });
      }
    }

    // Advance state
    this.state = tickReducer(this.state, this.pendingIntents, this.rng);

    // Clear intents after processing (only on decision ticks)
    if (isDecisionTick) {
      this.pendingIntents.clear();
      this.submittedIntents.clear();
      this.waitingForDecisions = false;
    }

    // On decision ticks, notify br.step() waiters, SSE clients, and MCP observers
    if (this.state.tick % DECISION_INTERVAL === 0) {
      this.resolveStepWaiters();
      this.pushSSEObservations();
      this.pushMcpObservations();
    }


    // Broadcast to viewer spectators
    if (this.state.tick % VIEWER_TICK_INTERVAL === 0) {
      this.broadcastViewerState();
    }

    // Check if game ended
    if (this.state.phase === "finished") {
      this.handleGameEnd();
    }
  }

  /** Push a "waiting for your action" notification to MCP observers who haven't submitted */
  private pushMcpWaitingNotification(): void {
    if (!this.state) return;
    const aliveIds = this.getAlivePlayerIds();
    const total = aliveIds.length;
    const submitted = this.submittedIntents.size;
    const timeoutS = DECISION_WAIT_TIMEOUT_MS / 1000;

    for (const [playerId, callback] of this.mcpObservers) {
      if (!this.submittedIntents.has(playerId) && aliveIds.includes(playerId)) {
        try {
          callback({
            type: "observation",
            data: {
              status: "waiting_for_action",
              message: `Waiting for your action (${submitted}/${total} players submitted). You have ${timeoutS}s. Call gridroyale_step now!`,
            },
          });
        } catch { /* observer disconnected */ }
      }
    }
  }

  /** Pause the tick loop at a decision boundary and wait for all alive players */
  private pauseForDecisions(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.waitingForDecisions = true;

    const aliveCount = this.getAlivePlayerIds().length;
    const submitted = this.submittedIntents.size;
    console.log(`[Game] Decision pause at tick ${this.state!.tick + 1}: waiting for ${aliveCount - submitted}/${aliveCount} players (${DECISION_WAIT_TIMEOUT_MS / 1000}s timeout)`);

    // Notify MCP observers who haven't submitted yet
    this.pushMcpWaitingNotification();

    // Check if all already submitted (possible if actions came in during sim ticks)
    if (this.checkAllSubmitted()) return;

    // Set up timeout — advance even if not all players submitted
    this.decisionTimeout = setTimeout(() => {
      const submitted = this.submittedIntents.size;
      const alive = this.getAlivePlayerIds().length;
      console.log(`[Game] Decision timeout — advancing with ${submitted}/${alive} submitted`);

      // Track zombie games (0 submissions = nobody is playing)
      if (submitted === 0) {
        this.consecutiveEmptyDecisions++;
        console.log(`[Game] Consecutive empty decisions: ${this.consecutiveEmptyDecisions}/3`);
        if (this.consecutiveEmptyDecisions >= 3) {
          console.log(`[Game] Zombie game detected — force-ending (no submissions for 3 consecutive decisions)`);
          // Kill all alive players to force game end
          if (this.state) {
            for (const [id, player] of this.state.players) {
              if (player.alive) {
                this.state.players.set(id, { ...player, alive: false, hp: 0, deathTick: this.state.tick });
              }
            }
            this.state = { ...this.state, phase: "finished" as const };
          }
          this.handleGameEnd();
          return;
        }
      } else {
        this.consecutiveEmptyDecisions = 0;
      }

      this.resumeTicking();
    }, DECISION_WAIT_TIMEOUT_MS);
  }

  /** Check if all alive players have submitted, and resume if so */
  private checkAllSubmitted(): boolean {
    const aliveIds = this.getAlivePlayerIds();
    const allSubmitted = aliveIds.every((id) => this.submittedIntents.has(id));

    if (allSubmitted && this.waitingForDecisions) {
      console.log(`[Game] All ${aliveIds.length} players submitted — resuming`);
      this.consecutiveEmptyDecisions = 0; // healthy game
      if (this.decisionTimeout) {
        clearTimeout(this.decisionTimeout);
        this.decisionTimeout = null;
      }
      this.resumeTicking();
      return true;
    }
    return false;
  }

  /** Resume the tick loop after a decision pause */
  private resumeTicking(): void {
    this.decisionTimeout = null;
    // Fire the paused decision tick immediately
    this.tick();
    // Restart the interval for subsequent ticks
    if (this.state && this.state.phase === "active" && !this.tickTimer) {
      this.tickTimer = setInterval(() => this.tick(), SIM_TICK_MS);
    }
  }

  /** Get IDs of all alive players in the current game */
  private getAlivePlayerIds(): string[] {
    if (!this.state) return [];
    return Array.from(this.state.players.values())
      .filter((p) => p.alive)
      .map((p) => p.id);
  }

  private handleGameEnd(): void {
    // Stop tick loop and clear turn-based state
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.decisionTimeout) {
      clearTimeout(this.decisionTimeout);
      this.decisionTimeout = null;
    }
    this.waitingForDecisions = false;
    this.submittedIntents.clear();

    // Extract result
    this.lastResult = extractGameResult(this.state!);
    console.log(
      `[Game] Match ${this.matchId} ended — winner: ${this.lastResult?.winnerId ?? "none"}`,
    );

    // Resolve any remaining step waiters with finished result
    const finishedResponse = { status: "finished", result: this.lastResult };
    for (const waiter of this.stepWaiters) {
      waiter.resolve(finishedResponse);
    }
    this.stepWaiters = [];

    // Push game over to SSE clients
    this.pushSSEEvent("end", this.lastResult);

    // Push game over to MCP observers
    this.pushMcpGameOver();

    // Broadcast game over to spectators
    const gameOverMsg: ViewerGameOverMessage = {
      type: "game_over",
      winnerId: this.lastResult?.winnerId ?? null,
      winnerName: this.lastResult?.placements.find((p) => p.placement === 1)?.name ?? null,
      reason: this.lastResult?.reason ?? "unknown",
      placements: this.lastResult?.placements ?? [],
    };
    this.broadcastToSpectators(gameOverMsg);

    // Persist to database
    this.persistGameResult();

    // Clear match from all sessions
    for (const session of this.sessions.getAll()) {
      if (session.matchId === this.matchId) {
        this.sessions.clearMatch(session.token);
      }
    }

    // Reset for next game after delay
    setTimeout(() => {
      this.state = null;
      this.rng = null;
      this.matchId = null;
      this.lobby.reset();
      this.broadcastLobbyState();
      console.log("[Game] Ready for next game");
    }, 5000);
  }

  // ══════════════════════════════════════════
  // Internal — Step Waiters
  // ══════════════════════════════════════════

  private resolveStepWaiters(): void {
    if (!this.state || !this.matchId) return;

    const waiters = this.stepWaiters;
    this.stepWaiters = [];

    for (const waiter of waiters) {
      const obs = buildObservation(this.state, waiter.playerId, this.matchId);
      waiter.resolve(obs);
    }
  }

  // ══════════════════════════════════════════
  // Internal — SSE
  // ══════════════════════════════════════════

  private pushSSEObservations(): void {
    if (!this.state || !this.matchId) return;

    for (const client of this.sseClients) {
      try {
        const obs = buildObservation(this.state, client.playerId, this.matchId);
        if (obs) {
          const data = `event: observe\ndata: ${JSON.stringify(obs)}\n\n`;
          client.controller.enqueue(new TextEncoder().encode(data));
        }
      } catch {
        // Client disconnected
      }
    }
  }

  private pushSSEEvent(eventType: string, data: unknown): void {
    const encoded = new TextEncoder().encode(
      `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`,
    );
    for (const client of this.sseClients) {
      try {
        client.controller.enqueue(encoded);
      } catch {
        // Client disconnected
      }
    }
  }

  // ══════════════════════════════════════════
  // Internal — MCP Push
  // ══════════════════════════════════════════

  private pushMcpObservations(): void {
    if (!this.state || !this.matchId) return;

    for (const [playerId, callback] of this.mcpObservers) {
      try {
        const obs = buildObservation(this.state, playerId, this.matchId);
        if (obs) callback({ type: "observation", data: obs });
      } catch { /* observer disconnected */ }
    }
  }

  private pushMcpGameStart(): void {
    if (!this.state || !this.matchId) return;

    for (const [playerId, callback] of this.mcpObservers) {
      try {
        const obs = buildObservation(this.state, playerId, this.matchId);
        callback({ type: "game_start", data: obs });
      } catch { /* observer disconnected */ }
    }
  }

  private pushMcpGameOver(): void {
    for (const callback of this.mcpObservers.values()) {
      try {
        callback({ type: "game_over", data: { status: "finished", result: this.lastResult } });
      } catch { /* observer disconnected */ }
    }
  }

  // ══════════════════════════════════════════
  // Internal — Viewer Broadcasting
  // ══════════════════════════════════════════

  private broadcastViewerState(): void {
    const msg = this.getViewerState();
    if (msg) {
      this.broadcastToSpectators(msg);
    }
  }

  private broadcastLobbyState(): void {
    const msg = this.getLobbyState();
    this.broadcastToSpectators(msg);

    // Push lobby updates to MCP observers
    for (const callback of this.mcpObservers.values()) {
      try {
        callback({
          type: "lobby",
          data: {
            status: msg.phase === "countdown" ? "countdown" : "waiting",
            countdown: msg.countdown,
            players: msg.players.map((p) => p.name),
          },
        });
      } catch { /* observer disconnected */ }
    }
  }

  private broadcastToSpectators(msg: unknown): void {
    const json = JSON.stringify(msg);
    const dead: ServerWebSocket<unknown>[] = [];

    for (const ws of this.spectators) {
      try {
        ws.send(json);
      } catch {
        dead.push(ws);
      }
    }

    for (const ws of dead) {
      this.spectators.delete(ws);
    }
  }

  // ══════════════════════════════════════════
  // Internal — Persistence
  // ══════════════════════════════════════════

  private persistGameResult(): void {
    if (!this.lastResult || !this.matchId || !this.state) return;

    try {
      const now = Date.now();
      const durationS = (now - this.gameStartTime) / 1000;
      const winnerPlayer = this.lastResult.placements.find(p => p.placement === 1);

      // 1. Insert game record
      this.db.insert(games).values({
        id: this.matchId,
        seed: this.gameSeed,
        playerCount: this.lastResult.placements.length,
        winnerId: this.lastResult.winnerId,
        winnerName: winnerPlayer?.name ?? null,
        reason: this.lastResult.reason,
        totalTicks: this.lastResult.totalTicks,
        durationS,
        timestamp: new Date(now),
      }).run();

      // 2. Get current Elo for all players
      const playerElos: Array<{ name: string; elo: number; placement: number }> = [];
      for (const placement of this.lastResult.placements) {
        const existing = this.db.select().from(agentStats)
          .where(eq(agentStats.agentName, placement.name.toLowerCase()))
          .get();
        playerElos.push({
          name: placement.name.toLowerCase(),
          elo: existing?.elo ?? 1000,
          placement: placement.placement,
        });
      }

      // 3. Compute Elo changes
      const eloChanges = computeMultiplayerElo(playerElos);

      // 4. Insert game_players and update agent_stats
      for (const placement of this.lastResult.placements) {
        const nameLower = placement.name.toLowerCase();
        const eloChange = eloChanges.get(nameLower) ?? 0;
        const player = this.state.players.get(placement.playerId);
        const survivalTicks = player?.deathTick ?? this.state.tick;

        this.db.insert(gamePlayers).values({
          gameId: this.matchId!,
          playerId: placement.playerId,
          playerName: placement.name,
          placement: placement.placement,
          kills: placement.kills,
          damageDealt: 0,
          survivalTicks,
          eloChange,
        }).run();

        // Upsert agent_stats
        const existing = this.db.select().from(agentStats)
          .where(eq(agentStats.agentName, nameLower))
          .get();

        if (existing) {
          const isWin = placement.placement === 1;
          this.db.update(agentStats)
            .set({
              wins: existing.wins + (isWin ? 1 : 0),
              losses: existing.losses + (isWin ? 0 : 1),
              elo: existing.elo + eloChange,
              lastSeen: new Date(now),
            })
            .where(eq(agentStats.agentName, nameLower))
            .run();
        } else {
          this.db.insert(agentStats).values({
            agentName: nameLower,
            displayName: placement.name,
            wins: placement.placement === 1 ? 1 : 0,
            losses: placement.placement === 1 ? 0 : 1,
            draws: 0,
            elo: 1000 + eloChange,
            lastSeen: new Date(now),
          }).run();
        }
      }

      // 5. Persist intent log for replay
      if (this.intentLog.length > 0) {
        for (const entry of this.intentLog) {
          this.db.insert(intentsTable).values({
            gameId: this.matchId!,
            tick: entry.tick,
            playerId: entry.playerId,
            action: entry.intent.action,
            direction: entry.intent.dir ?? null,
          }).run();
        }
      }

      console.log(`[DB] Persisted match ${this.matchId} (${this.lastResult.placements.length} players, ${this.intentLog.length} intents)`);
    } catch (e) {
      console.error("[DB] Failed to persist game result:", e);
    }
  }

  // ══════════════════════════════════════════
  // Cleanup
  // ══════════════════════════════════════════

  destroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.decisionTimeout) clearTimeout(this.decisionTimeout);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.lobby.destroy();
  }
}
