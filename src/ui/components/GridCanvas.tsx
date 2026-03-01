import { useRef, useEffect, useCallback } from "react";
import { useArenaStore } from "../lib/store";
import { GRID_W, GRID_H } from "../../shared/constants";
import type { ViewerPlayer, ViewerProjectile, ViewerPickup, ViewerZone, Direction } from "../lib/types";

const PLAYER_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#a855f7", "#ec4899", "#06b6d4", "#f97316",
  "#84cc16", "#6366f1", "#14b8a6", "#e11d48",
  "#8b5cf6", "#0ea5e9", "#d946ef", "#facc15",
];

const PICKUP_COLORS: Record<string, string> = {
  MEDKIT: "#22c55e",
  SHIELD: "#3b82f6",
  AMMO: "#f59e0b",
  STAMINA: "#a855f7",
};

const DIRECTION_ARROWS: Record<Direction, string> = {
  N: "\u25B2",
  E: "\u25B6",
  S: "\u25BC",
  W: "\u25C0",
};

interface GridCanvasProps {
  width?: number;
  height?: number;
}

export function GridCanvas({ width = 720, height = 720 }: GridCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { players, projectiles, pickups, zone, tick } = useArenaStore();

  const cellW = width / GRID_W;
  const cellH = height / GRID_H;

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.clearRect(0, 0, width, height);

      // ── Background ──
      ctx.fillStyle = "#111827";
      ctx.fillRect(0, 0, width, height);

      // ── Zone (safe area vs danger) ──
      drawZone(ctx, zone, cellW, cellH);

      // ── Grid lines ──
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= GRID_W; x++) {
        ctx.beginPath();
        ctx.moveTo(x * cellW, 0);
        ctx.lineTo(x * cellW, height);
        ctx.stroke();
      }
      for (let y = 0; y <= GRID_H; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * cellH);
        ctx.lineTo(width, y * cellH);
        ctx.stroke();
      }

      // ── Pickups ──
      for (const pickup of pickups) {
        drawPickup(ctx, pickup, cellW, cellH);
      }

      // ── Projectiles ──
      for (const proj of projectiles) {
        drawProjectile(ctx, proj, cellW, cellH, players);
      }

      // ── Players ──
      const colorMap = new Map<string, string>();
      players.forEach((p, i) => colorMap.set(p.id, PLAYER_COLORS[i % PLAYER_COLORS.length]!));

      for (const player of players) {
        if (!player.alive) continue;
        const color = colorMap.get(player.id) ?? "#fff";
        drawPlayer(ctx, player, color, cellW, cellH);
      }
    },
    [players, projectiles, pickups, zone, width, height, cellW, cellH],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const id = requestAnimationFrame(() => draw(ctx));
    return () => cancelAnimationFrame(id);
  }, [draw, tick]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="border border-gray-700 rounded-lg"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

// ── Drawing Helpers ──

function drawZone(
  ctx: CanvasRenderingContext2D,
  zone: ViewerZone,
  cellW: number,
  cellH: number,
) {
  // Draw danger zone (outside safe area) with red tint
  const minX = zone.cx - zone.r;
  const maxX = zone.cx + zone.r;
  const minY = zone.cy - zone.r;
  const maxY = zone.cy + zone.r;

  // Top danger strip
  if (minY > 0) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.fillRect(0, 0, GRID_W * cellW, minY * cellH);
  }
  // Bottom danger strip
  if (maxY < GRID_H) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.fillRect(0, (maxY + 1) * cellH, GRID_W * cellW, (GRID_H - maxY - 1) * cellH);
  }
  // Left danger strip
  if (minX > 0) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.fillRect(0, minY * cellH, minX * cellW, (maxY - minY + 1) * cellH);
  }
  // Right danger strip
  if (maxX < GRID_W) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
    ctx.fillRect((maxX + 1) * cellW, minY * cellH, (GRID_W - maxX - 1) * cellW, (maxY - minY + 1) * cellH);
  }

  // Zone border
  ctx.strokeStyle = "rgba(239, 68, 68, 0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    minX * cellW,
    minY * cellH,
    (maxX - minX + 1) * cellW,
    (maxY - minY + 1) * cellH,
  );
}

function drawPickup(
  ctx: CanvasRenderingContext2D,
  pickup: ViewerPickup,
  cellW: number,
  cellH: number,
) {
  const cx = (pickup.x + 0.5) * cellW;
  const cy = (pickup.y + 0.5) * cellH;
  const size = Math.min(cellW, cellH) * 0.3;

  ctx.fillStyle = PICKUP_COLORS[pickup.kind] ?? "#fff";
  ctx.globalAlpha = 0.8;

  // Diamond shape
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size, cy);
  ctx.lineTo(cx, cy + size);
  ctx.lineTo(cx - size, cy);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 1;

  // Label
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.max(8, cellW * 0.35)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const label = pickup.kind[0]!; // M, S, A, or S
  ctx.fillText(label, cx, cy);
}

function drawProjectile(
  ctx: CanvasRenderingContext2D,
  proj: ViewerProjectile,
  cellW: number,
  cellH: number,
  players: ViewerPlayer[],
) {
  const cx = (proj.x + 0.5) * cellW;
  const cy = (proj.y + 0.5) * cellH;
  const r = Math.min(cellW, cellH) * 0.15;

  // Color based on owner
  const ownerIdx = players.findIndex((p) => p.id === proj.ownerId);
  ctx.fillStyle = ownerIdx >= 0 ? PLAYER_COLORS[ownerIdx % PLAYER_COLORS.length]! : "#fbbf24";
  ctx.globalAlpha = 0.9;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: ViewerPlayer,
  color: string,
  cellW: number,
  cellH: number,
) {
  const cx = (player.x + 0.5) * cellW;
  const cy = (player.y + 0.5) * cellH;
  const r = Math.min(cellW, cellH) * 0.38;

  // Player circle
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Facing direction indicator
  ctx.fillStyle = "#fff";
  ctx.font = `${Math.max(8, r * 0.9)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(DIRECTION_ARROWS[player.facing], cx, cy);

  // Name label
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.max(8, cellW * 0.4)}px monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(player.name.slice(0, 6), cx, cy - r - 2);

  // HP bar
  const barW = cellW * 0.9;
  const barH = 3;
  const barX = cx - barW / 2;
  const barY = cy + r + 2;

  // Background
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(barX, barY, barW, barH);

  // Shield (blue)
  if (player.shield > 0) {
    ctx.fillStyle = "#3b82f6";
    ctx.fillRect(barX, barY, barW * (player.shield / 50), barH);
  }

  // HP (green→yellow→red based on %)
  const hpPct = player.hp / 100;
  if (hpPct > 0.5) ctx.fillStyle = "#22c55e";
  else if (hpPct > 0.25) ctx.fillStyle = "#f59e0b";
  else ctx.fillStyle = "#ef4444";

  ctx.fillRect(barX, barY + barH, barW * hpPct, barH);
}

export default GridCanvas;
