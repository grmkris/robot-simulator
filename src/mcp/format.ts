// ═══════════════════════════════════════════════
// Shared observation formatter for MCP tools
// ═══════════════════════════════════════════════

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
  const enemies = obs.visible?.enemies ?? [];
  const pickups = obs.visible?.pickups ?? [];
  const projectiles = obs.visible?.projectiles ?? [];
  const events = obs.recentEvents ?? [];

  // Compute zone safety
  const myZoneDist = zone
    ? Math.max(Math.abs(me.x - zone.cx), Math.abs(me.y - zone.cy))
    : 0;
  const inZone = zone ? myZoneDist <= zone.r : true;

  const lines: string[] = [
    `## Tick ${obs.tick} | Decision #${obs.decisionIndex} | ${obs.playersAlive} alive`,
    "",
    `### You (${playerName})`,
    `  Position: (${me.x}, ${me.y}) facing ${me.facing}`,
    `  HP: ${me.hp}/100 | Shield: ${me.shield}/50 | Stamina: ${me.stamina}/100 | Ammo: ${me.ammo}/20`,
    `  Cooldowns: shoot=${me.cooldowns.shoot} dash=${me.cooldowns.dash} pickup=${me.cooldowns.pickup}`,
    "",
    `### Zone`,
    `  Center: (${zone?.cx}, ${zone?.cy}) Radius: ${zone?.r}`,
    `  You are ${inZone ? "INSIDE safe zone" : `OUTSIDE zone! Distance: ${myZoneDist} (taking 2 dmg/tick)`}`,
  ];

  if (enemies.length > 0) {
    lines.push("", `### Visible Enemies (${enemies.length})`);
    for (const e of enemies) {
      const dist = Math.max(Math.abs(e.x - me.x), Math.abs(e.y - me.y));
      const axisAligned =
        e.x === me.x ? `on same column (${e.y > me.y ? "S" : "N"})` :
        e.y === me.y ? `on same row (${e.x > me.x ? "E" : "W"})` : "diagonal";
      lines.push(`  ${e.id.slice(0, 6)} at (${e.x},${e.y}) hp=${e.hp} dist=${dist} ${axisAligned}`);
    }
  } else {
    lines.push("", "### No enemies visible");
  }

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

  if (projectiles.length > 0) {
    lines.push("", `### Projectiles (${projectiles.length})`);
    for (const p of projectiles) {
      const heading = p.dir;
      const willHit =
        (heading === "N" && p.x === me.x && p.y > me.y) ||
        (heading === "S" && p.x === me.x && p.y < me.y) ||
        (heading === "E" && p.y === me.y && p.x < me.x) ||
        (heading === "W" && p.y === me.y && p.x > me.x);
      lines.push(`  at (${p.x},${p.y}) heading ${heading}${willHit ? " ⚠ HEADING TOWARD YOU" : ""}`);
    }
  }

  // Recent kill events
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kills = events.filter((e: any) => e.type === "KILL");
  if (kills.length > 0) {
    lines.push("", "### Recent Kills");
    for (const k of kills.slice(-3)) {
      const d = k.data;
      lines.push(`  ${d.killerId ?? "Zone"} killed ${d.victimId} (${d.weapon})`);
    }
  }

  lines.push(
    "",
    "### Available Actions",
    `  MOVE <N|E|S|W>  — Move 1 tile`,
    `  DASH <N|E|S|W>  — Move 2 tiles (30 stamina, ${me.cooldowns.dash > 0 ? `on cooldown: ${me.cooldowns.dash} ticks` : "ready"})`,
    `  SHOOT <N|E|S|W> — Fire projectile (${me.ammo > 0 ? `${me.ammo} ammo left` : "NO AMMO"}, ${me.cooldowns.shoot > 0 ? `cooldown: ${me.cooldowns.shoot}` : "ready"})`,
    `  PICKUP          — Collect item on your tile (${me.cooldowns.pickup > 0 ? `cooldown: ${me.cooldowns.pickup}` : "ready"})`,
    `  NOOP            — Do nothing`,
  );

  return lines.join("\n");
}
