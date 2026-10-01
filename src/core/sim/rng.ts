/** Serialisable state for the seeded RNG. Lives in snapshots (§13.4.3). */
export type RngState = number;

/**
 * Seeded PRNG (mulberry32). The only source of randomness allowed in core (§14.9).
 * Deterministic for a given seed and cheap to snapshot.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  static fromState(state: RngState): Rng {
    return new Rng(state);
  }

  get state(): RngState {
    return this.s;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max). */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  pick<T>(items: ArrayLike<T>): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[this.int(0, items.length)] as T;
  }
}
