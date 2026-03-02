// ═══════════════════════════════════════════════
// Shared observation formatter for MCP tools
// ═══════════════════════════════════════════════

import { ZONE_SHRINK_INTERVAL, ZONE_DAMAGE_PER_TICK, DECISION_INTERVAL } from "../shared/constants.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function formatObservation(obs: any, playerName: string | null, playerId: string | null): string {
  if (!obs) return "No observation available.";

  // Waiting for action (turn-based pause)
  if (obs.status === "waiting_for_action") {
    return `⏳ ${obs.message}`;
  }

  // Lobby state
  if (obs.status === "waiting" || obs.status === "countdown") {
    return [
      `## Lobby`,
      `Status: ${obs.status}`,
      obs.countdown != null ? `Countdown: ${obs.countdown}s` : null,
      `Players: ${(obs.players ?? []).join(", ") || "none"}`,
      "",
      "Waiting for more players to join. Keep calling `gridroyale_step` to poll.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  // Game finished
  if (obs.status === "finished") {
    const r = obs.result;
    if (!r) return "Game finished. No result data.";
    const lines = [`## Game Over`, `Winner: ${r.winnerId ?? "none"}`, "", "### Placements"];
    for (const p of r.placements ?? []) {
      const marker = p.playerId === playerId ? " ← YOU" : "";
      lines.push(`  #${p.placement} ${p.name} (${p.kills} kills)${marker}`);
    }
    return lines.join("\n");
  }

  // Active game observation
  const me = obs.self;
  if (!me) return JSON.stringify(obs, null, 2);

  const zone = obs.zone;
  const tiles = obs.visible?.tiles ?? [];
  const enemies = obs.visible?.enemies ?? [];
  const pickups = obs.visible?.pickups ?? [];
  const projectiles = obs.visible?.projectiles ?? [];
  const events = obs.recentEvents ?? [];
  const lastAction = obs.lastAction;

  // Build a set of wall positions for quick lookup
  const wallSet = new Set<string>();
  for (const t of tiles) {
    if (t.t === 1 /* WALL */) {
      wallSet.add(`${t.x},${t.y}`);
    }
  }

  // Compute zone safety
  const myZoneDist = zone
    ? Math.max(Math.abs(me.x - zone.cx), Math.abs(me.y - zone.cy))
    : 0;
  const inZone = zone ? myZoneDist <= zone.r : true;
  const distToZoneEdge = zone ? zone.r - myZoneDist : 0;

  const lines: string[] = [
    `## Tick ${obs.tick} | Decision #${obs.decisionIndex} | ${obs.playersAlive} alive`,
  ];

  // ── Last Action Feedback ──
  if (lastAction) {
    const actionStr = lastAction.dir ? `${lastAction.action} ${lastAction.dir}` : lastAction.action;
    if (lastAction.success) {
      lines.push("", `### Last Action: ${actionStr} → OK`);
    } else {
      const reasonMap: Record<string, string> = {
        blocked_by_wall: "blocked by wall",
        blocked_by_player: "blocked by another player",
        out_of_bounds: "out of bounds",
        on_cooldown: "on cooldown",
        no_ammo: "no ammo",
        no_stamina: "not enough stamina",
        no_pickup: "no item on your tile",
      };
      const reason = reasonMap[lastAction.reason ?? ""] ?? lastAction.reason ?? "failed";
      lines.push("", `### Last Action: ${actionStr} → FAILED (${reason})`);
    }
  }

  // ── Player Status ──
  lines.push(
    "",
    `### You (${playerName})`,
    `  Position: (${me.x}, ${me.y}) facing ${me.facing}`,
    `  HP: ${me.hp}/100 | Shield: ${me.shield}/50 | Stamina: ${me.stamina}/100 | Ammo: ${me.ammo}/20`,
    `  Cooldowns: shoot=${me.cooldowns.shoot} dash=${me.cooldowns.dash} pickup=${me.cooldowns.pickup}`,
  );

  // ── Passable Directions ──
  const dirChecks = [
    { dir: "N", dx: 0, dy: -1 },
    { dir: "E", dx: 1, dy: 0 },
    { dir: "S", dx: 0, dy: 1 },
    { dir: "W", dx: -1, dy: 0 },
  ];
  lines.push("", "### Movement");
  for (const { dir, dx, dy } of dirChecks) {
    const nx = me.x + dx;
    const ny = me.y + dy;
    if (nx < 0 || nx >= 40 || ny < 0 || ny >= 40) {
      lines.push(`  ${dir}: out of bounds`);
    } else if (wallSet.has(`${nx},${ny}`)) {
      lines.push(`  ${dir}: WALL at (${nx},${ny}) — blocked`);
    } else {
      lines.push(`  ${dir}: open (${nx},${ny})`);
    }
  }

  // ── Zone ──
  const nextShrinkTick = zone ? (Math.floor(obs.tick / ZONE_SHRINK_INTERVAL) + 1) * ZONE_SHRINK_INTERVAL : 0;
  const ticksUntilShrink = nextShrinkTick - obs.tick;
  lines.push(
    "",
    `### Zone`,
    `  Center: (${zone?.cx}, ${zone?.cy}) Radius: ${zone?.r}`,
    `  You are ${inZone ? `INSIDE safe zone (${distToZoneEdge} tiles from edge)` : `OUTSIDE zone! Distance: ${myZoneDist - zone.r} beyond edge (taking ${ZONE_DAMAGE_PER_TICK} dmg/tick)`}`,
    `  Next shrink in ${ticksUntilShrink} ticks (~${Math.ceil(ticksUntilShrink / DECISION_INTERVAL)} decisions)`,
  );

  // ── Enemies ──
  if (enemies.length > 0) {
    lines.push("", `### Visible Enemies (${enemies.length})`);
    for (const e of enemies) {
      const dist = Math.max(Math.abs(e.x - me.x), Math.abs(e.y - me.y));
      const canShoot =
        e.x === me.x ? `SHOOTABLE ${e.y > me.y ? "S" : "N"} (same column)` :
        e.y === me.y ? `SHOOTABLE ${e.x > me.x ? "E" : "W"} (same row)` : "diagonal (can't shoot directly)";
      lines.push(`  ${e.id.slice(0, 6)} at (${e.x},${e.y}) hp=${e.hp} shield=${e.shield} dist=${dist} — ${canShoot}`);
    }
  } else {
    lines.push("", "### No enemies visible");
  }

  // ── Pickups ──
  if (pickups.length > 0) {
    lines.push("", `### Visible Pickups (${pickups.length})`);
    for (const p of pickups) {
      const dist = Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y));
      const onTile = p.x === me.x && p.y === me.y;
      const dx = p.x - me.x;
      const dy = p.y - me.y;
      const dirs: string[] = [];
      if (dy < 0) dirs.push("N");
      if (dy > 0) dirs.push("S");
      if (dx > 0) dirs.push("E");
      if (dx < 0) dirs.push("W");
      const dirHint = onTile ? "ON YOUR TILE — use PICKUP!" : dirs.join("")+` dist=${dist}`;
      lines.push(`  ${p.kind} at (${p.x},${p.y}) ${dirHint}`);
    }
  } else {
    lines.push("", "### No pickups visible");
  }

  // ── Projectiles ──
  if (projectiles.length > 0) {
    lines.push("", `### Projectiles (${projectiles.length})`);
    for (const p of projectiles) {
      const heading = p.dir;
      const isOwn = p.own;

      // Calculate if heading toward the agent and estimated distance
      let threatInfo = "";
      if (heading === "N" && p.x === me.x && p.y > me.y) {
        const dist = p.y - me.y;
        threatInfo = ` ⚠ HEADING TOWARD YOU (~${dist} ticks away)`;
      } else if (heading === "S" && p.x === me.x && p.y < me.y) {
        const dist = me.y - p.y;
        threatInfo = ` ⚠ HEADING TOWARD YOU (~${dist} ticks away)`;
      } else if (heading === "E" && p.y === me.y && p.x < me.x) {
        const dist = me.x - p.x;
        threatInfo = ` ⚠ HEADING TOWARD YOU (~${dist} ticks away)`;
      } else if (heading === "W" && p.y === me.y && p.x > me.x) {
        const dist = p.x - me.x;
        threatInfo = ` ⚠ HEADING TOWARD YOU (~${dist} ticks away)`;
      }

      const ownership = isOwn ? "YOUR SHOT" : "ENEMY";
      lines.push(`  ${ownership} at (${p.x},${p.y}) heading ${heading}${threatInfo}`);
    }
  }

  // ── Recent kill events ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kills = events.filter((e: any) => e.type === "KILL");
  if (kills.length > 0) {
    lines.push("", "### Recent Kills");
    for (const k of kills.slice(-3)) {
      const d = k.data;
      lines.push(`  ${d.killerId ?? "Zone"} killed ${d.victimId} (${d.weapon})`);
    }
  }

  // ── Situation Summary ──
  lines.push("", "### Situation");
  // Nearest enemy
  if (enemies.length > 0) {
    const nearest = enemies.reduce((best: typeof enemies[0], e: typeof enemies[0]) => {
      const d = Math.max(Math.abs(e.x - me.x), Math.abs(e.y - me.y));
      const bd = Math.max(Math.abs(best.x - me.x), Math.abs(best.y - me.y));
      return d < bd ? e : best;
    });
    const nd = Math.max(Math.abs(nearest.x - me.x), Math.abs(nearest.y - me.y));
    lines.push(`  Nearest enemy: ${nd} tiles away`);
  } else {
    lines.push(`  No enemies in sight`);
  }
  // Nearest pickup
  if (pickups.length > 0) {
    const nearest = pickups.reduce((best: typeof pickups[0], p: typeof pickups[0]) => {
      const d = Math.max(Math.abs(p.x - me.x), Math.abs(p.y - me.y));
      const bd = Math.max(Math.abs(best.x - me.x), Math.abs(best.y - me.y));
      return d < bd ? p : best;
    });
    const nd = Math.max(Math.abs(nearest.x - me.x), Math.abs(nearest.y - me.y));
    const onTile = nearest.x === me.x && nearest.y === me.y;
    lines.push(`  Nearest pickup: ${nearest.kind} ${onTile ? "ON YOUR TILE" : `${nd} tiles away`}`);
  }
  // Incoming threats
  const incomingCount = projectiles.filter((p: typeof projectiles[0]) => {
    return (
      (p.dir === "N" && p.x === me.x && p.y > me.y) ||
      (p.dir === "S" && p.x === me.x && p.y < me.y) ||
      (p.dir === "E" && p.y === me.y && p.x < me.x) ||
      (p.dir === "W" && p.y === me.y && p.x > me.x)
    );
  }).length;
  if (incomingCount > 0) {
    lines.push(`  ⚠ ${incomingCount} projectile(s) heading toward you — DODGE!`);
  }

  // ── Available Actions ──
  lines.push(
    "",
    "### Available Actions",
    `  MOVE <N|E|S|W>  — Move 1 tile (see Movement section above for passable directions)`,
    `  DASH <N|E|S|W>  — Move 2 tiles (30 stamina, ${me.cooldowns.dash > 0 ? `on cooldown: ${me.cooldowns.dash} ticks` : "ready"})`,
    `  SHOOT <N|E|S|W> — Fire projectile (${me.ammo > 0 ? `${me.ammo} ammo left` : "NO AMMO"}, ${me.cooldowns.shoot > 0 ? `cooldown: ${me.cooldowns.shoot}` : "ready"})`,
    `  PICKUP          — Collect item on your tile (${me.cooldowns.pickup > 0 ? `cooldown: ${me.cooldowns.pickup}` : "ready"})`,
    `  NOOP            — Do nothing`,
  );

  return lines.join("\n");
}
