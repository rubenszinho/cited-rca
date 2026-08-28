/**
 * Wall-clock for a bundle.
 *
 * Every case uses the same fixed start instant. Real timestamps would make the
 * fixtures differ on every regeneration, which would break
 * `task project:fixtures:verify` and, worse, make the committed evidence
 * unverifiable.
 */

/** Fixed epoch for every bundle: 2026-03-17T09:00:00Z. */
export const WINDOW_START = Date.parse('2026-03-17T09:00:00Z');

const MINUTE = 60_000;

export function atMinute(minute: number, second = 0): string {
  return new Date(WINDOW_START + minute * MINUTE + second * 1000).toISOString();
}

/** Sort any timestamped records into wall-clock order. */
export function chronological<T extends { ts: string }>(records: T[]): T[] {
  return [...records].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
}
