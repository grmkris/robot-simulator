// ═══════════════════════════════════════════════
// Seeded PRNG — xoshiro128** (deterministic)
// ═══════════════════════════════════════════════
//
// All randomness in the engine flows through this.
// No Math.random() anywhere in the simulation.

export class SeededRNG {
  private s: Uint32Array;

  constructor(seed: number) {
    // Initialize state via SplitMix32 (generates 4 seeds from 1)
    this.s = new Uint32Array(4);
    let z = (seed | 0) >>> 0;
    for (let i = 0; i < 4; i++) {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z;
      t = ((t ^ (t >>> 16)) * 0x21f0aaad) >>> 0;
      t = ((t ^ (t >>> 15)) * 0x735a2d97) >>> 0;
      t = (t ^ (t >>> 15)) >>> 0;
      this.s[i] = t;
    }
    // Ensure non-zero state
    if (this.s[0] === 0 && this.s[1] === 0 && this.s[2] === 0 && this.s[3] === 0) {
      this.s[0] = 1;
    }
  }

  /** Get next raw uint32 via xoshiro128** */
  private nextU32(): number {
    const s = this.s;
    const result = (Math.imul(s[1]! * 5, 1) << 7 | (Math.imul(s[1]! * 5, 1) >>> 25)) * 9;
    const t = (s[1]! << 9) >>> 0;

    s[2]! ^= s[0]!;
    s[3]! ^= s[1]!;
    s[1]! ^= s[2]!;
    s[0]! ^= s[3]!;
    s[2]! ^= t;
    s[3] = ((s[3]! << 11) | (s[3]! >>> 21)) >>> 0;

    return result >>> 0;
  }

  /** Returns float in [0, 1) */
  next(): number {
    return this.nextU32() / 0x100000000;
  }

  /** Returns integer in [0, max) */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Returns integer in [min, max] inclusive */
  nextIntRange(min: number, max: number): number {
    return min + this.nextInt(max - min + 1);
  }

  /** Returns true with probability p */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Fisher-Yates shuffle (in-place, returns same array) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const tmp = arr[i]!;
      arr[i] = arr[j]!;
      arr[j] = tmp;
    }
    return arr;
  }

  /** Pick a random element from an array */
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextInt(arr.length)]!;
  }

  /** Clone the RNG state for forking */
  clone(): SeededRNG {
    const copy = new SeededRNG(0);
    copy.s.set(this.s);
    return copy;
  }
}
