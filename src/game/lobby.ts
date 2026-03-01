// ═══════════════════════════════════════════════
// Lobby — Pre-game waiting room
// ═══════════════════════════════════════════════

import { MIN_PLAYERS, MAX_PLAYERS, LOBBY_COUNTDOWN_S } from "../shared/constants.js";

export interface LobbyPlayer {
  playerId: string;
  name: string;
  token: string;
  joinedAt: number;
}

export type LobbyPhase = "waiting" | "countdown" | "starting";

export class Lobby {
  private players: LobbyPlayer[] = [];
  private _phase: LobbyPhase = "waiting";
  private _countdown: number = LOBBY_COUNTDOWN_S;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private onStart: ((players: LobbyPlayer[]) => void) | null = null;
  private onChange: (() => void) | null = null;

  get phase(): LobbyPhase {
    return this._phase;
  }

  get countdown(): number | null {
    return this._phase === "countdown" ? this._countdown : null;
  }

  get playerCount(): number {
    return this.players.length;
  }

  get isFull(): boolean {
    return this.players.length >= MAX_PLAYERS;
  }

  getPlayers(): LobbyPlayer[] {
    return [...this.players];
  }

  /** Set callback for when the game should start */
  setOnStart(cb: (players: LobbyPlayer[]) => void): void {
    this.onStart = cb;
  }

  /** Set callback for lobby state changes */
  setOnChange(cb: () => void): void {
    this.onChange = cb;
  }

  /** Add a player to the lobby. Returns false if full or duplicate. */
  addPlayer(player: LobbyPlayer): boolean {
    if (this.isFull) return false;
    if (this._phase === "starting") return false;

    // Check duplicate
    if (this.players.some((p) => p.playerId === player.playerId)) return false;

    this.players.push(player);
    console.log(`[Lobby] "${player.name}" joined (${this.players.length}/${MAX_PLAYERS})`);

    this.onChange?.();

    // Start countdown when minimum players reached
    if (this.players.length >= MIN_PLAYERS && this._phase === "waiting") {
      this.startCountdown();
    }

    // Auto-start immediately if lobby is full
    if (this.isFull && this._phase === "countdown") {
      this.finishCountdown();
    }

    return true;
  }

  /** Remove a player from the lobby by token */
  removePlayer(token: string): boolean {
    const idx = this.players.findIndex((p) => p.token === token);
    if (idx === -1) return false;

    const removed = this.players.splice(idx, 1)[0]!;
    console.log(`[Lobby] "${removed.name}" left (${this.players.length}/${MAX_PLAYERS})`);

    this.onChange?.();

    // Cancel countdown if below minimum
    if (this.players.length < MIN_PLAYERS && this._phase === "countdown") {
      this.cancelCountdown();
    }

    return true;
  }

  /** Get player by token */
  getPlayerByToken(token: string): LobbyPlayer | null {
    return this.players.find((p) => p.token === token) ?? null;
  }

  /** Check if a player is in the lobby */
  hasPlayer(token: string): boolean {
    return this.players.some((p) => p.token === token);
  }

  private startCountdown(): void {
    this._phase = "countdown";
    this._countdown = LOBBY_COUNTDOWN_S;
    console.log(`[Lobby] Countdown started: ${this._countdown}s`);

    this.countdownTimer = setInterval(() => {
      this._countdown--;
      this.onChange?.();

      if (this._countdown <= 0) {
        this.finishCountdown();
      }
    }, 1000);
  }

  private finishCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }

    this._phase = "starting";
    const gamePlayers = [...this.players];
    console.log(`[Lobby] Starting game with ${gamePlayers.length} players`);

    this.onStart?.(gamePlayers);
  }

  private cancelCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this._phase = "waiting";
    this._countdown = LOBBY_COUNTDOWN_S;
    console.log(`[Lobby] Countdown cancelled (not enough players)`);
  }

  /** Reset the lobby for a new game */
  reset(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    this.players = [];
    this._phase = "waiting";
    this._countdown = LOBBY_COUNTDOWN_S;
  }

  /** Destroy the lobby (cleanup timers) */
  destroy(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}
