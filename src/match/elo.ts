/** Expected score for player A against player B */
function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

/**
 * Compute Elo changes for a multi-player game using pairwise comparison.
 *
 * Each player is compared against every other player. The player with
 * the better placement "wins" that pair.
 *
 * @param players - Array of { name, elo, placement }
 * @returns Map of player name → elo change (delta)
 */
export function computeMultiplayerElo(
  players: Array<{ name: string; elo: number; placement: number }>,
): Map<string, number> {
  const K = 32;
  const n = players.length;
  const changes = new Map<string, number>();

  if (n < 2) return changes;

  for (const p of players) {
    let totalDelta = 0;

    for (const q of players) {
      if (p.name === q.name) continue;

      const expected = expectedScore(p.elo, q.elo);

      let actual: number;
      if (p.placement < q.placement) actual = 1;
      else if (p.placement === q.placement) actual = 0.5;
      else actual = 0;

      totalDelta += K * (actual - expected);
    }

    // Average over opponents
    const delta = Math.round((totalDelta / (n - 1)) * 10) / 10;
    changes.set(p.name, delta);
  }

  return changes;
}
