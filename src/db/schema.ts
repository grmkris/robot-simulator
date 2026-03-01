import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { baseEntityFields } from "./columns.js";

export const games = sqliteTable("games", {
  id: text("id").primaryKey(),
  seed: integer("seed").notNull(),
  playerCount: integer("player_count").notNull(),
  winnerId: text("winner_id"),
  winnerName: text("winner_name"),
  reason: text("reason").notNull(),
  totalTicks: integer("total_ticks").notNull(),
  durationS: real("duration_s").notNull(),
  timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
  ...baseEntityFields,
});

export const gamePlayers = sqliteTable("game_players", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: text("game_id").notNull().references(() => games.id),
  playerId: text("player_id").notNull(),
  playerName: text("player_name").notNull(),
  placement: integer("placement").notNull(),
  kills: integer("kills").notNull().default(0),
  damageDealt: integer("damage_dealt").notNull().default(0),
  survivalTicks: integer("survival_ticks").notNull().default(0),
  eloChange: real("elo_change"),
  ...baseEntityFields,
});

export const intents = sqliteTable("intents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  gameId: text("game_id").notNull().references(() => games.id),
  tick: integer("tick").notNull(),
  playerId: text("player_id").notNull(),
  action: text("action").notNull(),
  direction: text("direction"),
});

export const agentStats = sqliteTable("agent_stats", {
  agentName: text("agent_name").primaryKey(),
  displayName: text("display_name").notNull(),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  draws: integer("draws").notNull().default(0),
  elo: real("elo").notNull().default(1000),
  lastSeen: integer("last_seen", { mode: "timestamp_ms" }),
  ...baseEntityFields,
});
