/**
 * Seeded PRNG.
 *
 * The bundles are committed AND regenerable: `task project:fixtures:verify`
 * rebuilds them and fails if a byte moved. That only holds if every random
 * choice comes from a seed, so nothing here may reach for Math.random.
 */

/** mulberry32 — small, fast, and identical across Node versions. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic seed from a case id, so cases never share a stream. */
export function seedFrom(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Random {
  private next: () => number;

  constructor(seed: number | string) {
    this.next = rng(typeof seed === 'string' ? seedFrom(seed) : seed);
  }

  float(): number {
    return this.next();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  /** Jitter a value by +/- pct, clamped at zero. */
  jitter(value: number, pct: number): number {
    const delta = value * pct * (this.next() * 2 - 1);
    return Math.max(0, value + delta);
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }
}
