// GridRoyale survival bot — Protocol v7
const SERVER = "https://ai-arena-v2-production.up.railway.app";

const DIRS = ["N", "E", "S", "W"] as const;
type Dir = (typeof DIRS)[number];

interface Self {
  id: string; x: number; y: number;
  hp: number; shield: number; stamina: number; ammo: number;
  facing: Dir;
  cooldowns: { shoot: number; dash: number; pickup: number };
}

interface Obs {
  status?: string;
  matchId?: string;
  tick?: number;
  self?: Self;
  zone?: { cx: number; cy: number; r: number };
  visible?: {
    enemies: Array<{ id: string; x: number; y: number; hp: number }>;
    pickups: Array<{ id: number; kind: string; x: number; y: number }>;
    projectiles: Array<{ id: number; x: number; y: number; dir: Dir }>;
  };
  playersAlive?: number;
  result?: {
    winnerId: string | null;
    placements: Array<{ playerId: string; name: string; placement: number; kills: number }>;
  };
}

function dirToward(fx: number, fy: number, tx: number, ty: number): Dir | null {
  const dx = tx - fx;
  const dy = ty - fy;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "E" : "W";
  }
  return dy > 0 ? "S" : "N";
}

function chebyshev(x1: number, y1: number, x2: number, y2: number) {
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
}

function isInZone(x: number, y: number, zone: { cx: number; cy: number; r: number }) {
  return chebyshev(x, y, zone.cx, zone.cy) <= zone.r;
}

function chooseAction(obs: Obs): { t: string; dir?: string } | null {
  const me = obs.self;
  const zone = obs.zone;
  if (!me) return null;

  const enemies = obs.visible?.enemies ?? [];
  const pickups = obs.visible?.pickups ?? [];
  const projectiles = obs.visible?.projectiles ?? [];

  // 1. Dodge incoming projectiles
  for (const p of projectiles) {
    const willHit =
      (p.dir === "N" && p.x === me.x && p.y > me.y && p.y - me.y <= 3) ||
      (p.dir === "S" && p.x === me.x && p.y < me.y && me.y - p.y <= 3) ||
      (p.dir === "E" && p.y === me.y && p.x < me.x && me.x - p.x <= 3) ||
      (p.dir === "W" && p.y === me.y && p.x > me.x && p.x - me.x <= 3);
    if (willHit) {
      const dodge: Dir = (p.dir === "N" || p.dir === "S") ? "E" : "N";
      if (me.stamina >= 30 && me.cooldowns.dash === 0) {
        return { t: "DASH", dir: dodge };
      }
      return { t: "MOVE", dir: dodge };
    }
  }

  // 2. If outside zone, rush toward zone center
  if (zone && !isInZone(me.x, me.y, zone)) {
    const dir = dirToward(me.x, me.y, zone.cx, zone.cy);
    if (dir) {
      if (me.stamina >= 30 && me.cooldowns.dash === 0) {
        return { t: "DASH", dir };
      }
      return { t: "MOVE", dir };
    }
  }

  // 3. Pick up items on our tile
  const itemHere = pickups.find((p) => p.x === me.x && p.y === me.y);
  if (itemHere && me.cooldowns.pickup === 0) {
    return { t: "PICKUP" };
  }

  // 4. Shoot at axis-aligned enemies
  if (me.ammo > 0 && me.cooldowns.shoot === 0) {
    const axisEnemies = enemies.filter((e) => e.x === me.x || e.y === me.y);
    if (axisEnemies.length > 0) {
      const nearest = axisEnemies.sort(
        (a, b) => chebyshev(me.x, me.y, a.x, a.y) - chebyshev(me.x, me.y, b.x, b.y)
      )[0];
      const dir = dirToward(me.x, me.y, nearest.x, nearest.y);
      if (dir) return { t: "SHOOT", dir };
    }
  }

  // 5. Move toward nearest pickup
  if (pickups.length > 0) {
    let target = pickups;
    if (me.hp < 60) {
      const medkits = pickups.filter((p) => p.kind === "MEDKIT");
      if (medkits.length > 0) target = medkits;
    }
    const nearest = target.sort(
      (a, b) => chebyshev(me.x, me.y, a.x, a.y) - chebyshev(me.x, me.y, b.x, b.y)
    )[0];
    const dir = dirToward(me.x, me.y, nearest.x, nearest.y);
    if (dir) return { t: "MOVE", dir };
  }

  // 6. Move toward zone center
  if (zone) {
    const dir = dirToward(me.x, me.y, zone.cx, zone.cy);
    if (dir) return { t: "MOVE", dir };
  }

  return null;
}

async function step(token: string, action?: { t: string; dir?: string }): Promise<Obs> {
  const res = await fetch(`${SERVER}/api/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(action ? { action } : {}),
  });
  return res.json() as Promise<Obs>;
}

async function runBot(name: string, verbose: boolean) {
  // Queue
  const qRes = await fetch(`${SERVER}/api/queue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const qData = (await qRes.json()) as any;
  if (qData.error) {
    console.log(`[${name}] Queue error: ${qData.error}`);
    return null;
  }
  const { token, playerId } = qData;
  console.log(`[${name}] Queued as ${playerId}`);

  let turn = 0;
  let obs = await step(token);

  // Wait through lobby
  while (obs.status === "waiting" || obs.status === "countdown") {
    if (verbose) console.log(`[${name}] Lobby: ${obs.status}`);
    await Bun.sleep(500);
    obs = await step(token);
  }

  if (verbose) console.log(`[${name}] Game started! Match: ${obs.matchId}`);

  // Game loop
  while (obs.status !== "finished" && obs.self) {
    turn++;
    const action = chooseAction(obs);
    const me = obs.self;
    if (verbose) {
      const label = action ? JSON.stringify(action) : "NOOP";
      console.log(
        `[${name}] t=${obs.tick} pos=(${me.x},${me.y}) hp=${me.hp} ammo=${me.ammo} alive=${obs.playersAlive} → ${label}`
      );
    }
    obs = await step(token, action ?? undefined);
  }

  console.log(`\n[${name}] === GAME OVER ===`);
  if (obs.result) {
    const me = obs.result.placements?.find((p) => p.playerId === playerId);
    if (me) {
      console.log(`[${name}] Rank: #${me.placement} | Kills: ${me.kills}`);
    }
    return obs.result;
  }
  return null;
}

async function main() {
  const ts = Date.now().toString(36);
  const name1 = `Hunter_${ts}`;
  const name2 = `Scout_${ts}`;

  console.log(`Spawning two bots: ${name1} and ${name2}\n`);

  // Launch both in parallel — they'll meet in the same game
  const [r1, r2] = await Promise.all([
    runBot(name1, true),
    runBot(name2, false),  // quiet for the second bot
  ]);

  if (r1) {
    console.log("\nFinal placements:");
    for (const p of r1.placements ?? []) {
      console.log(`  #${p.placement} ${p.name} (${p.kills} kills)`);
    }
  }
}

main().catch(console.error);
