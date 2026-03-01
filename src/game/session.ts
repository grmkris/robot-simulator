// ═══════════════════════════════════════════════
// Player Session Management — Token-based auth
// ═══════════════════════════════════════════════

export interface PlayerSession {
  token: string;
  playerId: string;
  name: string;
  matchId: string | null;
  joinedAt: number;
  lastPollTime: number;
}

export class SessionManager {
  private tokenToSession = new Map<string, PlayerSession>();
  private playerIdToToken = new Map<string, string>();
  private nameToToken = new Map<string, string>();

  /** Create a new session. Returns null if name already taken. */
  create(name: string): PlayerSession | null {
    const nameLower = name.toLowerCase();
    if (this.nameToToken.has(nameLower)) return null;

    const token = crypto.randomUUID();
    const playerId = crypto.randomUUID().slice(0, 8);
    const now = Date.now();

    const session: PlayerSession = {
      token,
      playerId,
      name,
      matchId: null,
      joinedAt: now,
      lastPollTime: now,
    };

    this.tokenToSession.set(token, session);
    this.playerIdToToken.set(playerId, token);
    this.nameToToken.set(nameLower, token);

    return session;
  }

  /** Get session by token */
  getByToken(token: string): PlayerSession | null {
    const session = this.tokenToSession.get(token) ?? null;
    if (session) {
      session.lastPollTime = Date.now();
    }
    return session;
  }

  /** Get session by player ID */
  getByPlayerId(playerId: string): PlayerSession | null {
    const token = this.playerIdToToken.get(playerId);
    if (!token) return null;
    return this.getByToken(token);
  }

  /** Check if a name is already taken */
  isNameTaken(name: string): boolean {
    return this.nameToToken.has(name.toLowerCase());
  }

  /** Remove a session */
  remove(token: string): boolean {
    const session = this.tokenToSession.get(token);
    if (!session) return false;

    this.tokenToSession.delete(token);
    this.playerIdToToken.delete(session.playerId);
    this.nameToToken.delete(session.name.toLowerCase());
    return true;
  }

  /** Assign a match to a session */
  assignMatch(token: string, matchId: string): void {
    const session = this.tokenToSession.get(token);
    if (session) {
      session.matchId = matchId;
    }
  }

  /** Clear match from a session */
  clearMatch(token: string): void {
    const session = this.tokenToSession.get(token);
    if (session) {
      session.matchId = null;
    }
  }

  /** Get all sessions in a match */
  getMatchSessions(matchId: string): PlayerSession[] {
    const sessions: PlayerSession[] = [];
    for (const session of this.tokenToSession.values()) {
      if (session.matchId === matchId) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /** Remove stale sessions (not polled in timeout ms) */
  removeStale(timeoutMs: number): PlayerSession[] {
    const now = Date.now();
    const stale: PlayerSession[] = [];
    for (const session of this.tokenToSession.values()) {
      if (now - session.lastPollTime > timeoutMs && session.matchId === null) {
        stale.push(session);
      }
    }
    for (const s of stale) {
      this.remove(s.token);
    }
    return stale;
  }

  /** Get total session count */
  get size(): number {
    return this.tokenToSession.size;
  }

  /** Get all active sessions */
  getAll(): PlayerSession[] {
    return Array.from(this.tokenToSession.values());
  }
}
