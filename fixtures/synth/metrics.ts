/**
 * Metric series emission.
 *
 * One CSV per MetricSpec, one row per minute. The shapes are deliberately
 * coarse: the point is that a correct RCA cites the series that actually moved
 * and the minute it moved, not that the numbers model real queueing theory.
 */
import type { MetricSeries } from '../model.ts';
import type { Random } from '../rng.ts';
import type { MetricSpec, SeriesSpec, Shape } from './spec.ts';
import { atMinute } from './timeline.ts';

/**
 * Multiplier applied to a series' base at `progress` (0..1) through the fault.
 * Table dispatch rather than a switch: adding a shape is a new entry, and the
 * compiler flags any Shape that has none.
 */
const RESPONSE: Record<Shape, (factor: number, progress: number) => number> = {
  flat: () => 1,
  step: (factor) => factor,
  ramp: (factor, progress) => 1 + (factor - 1) * progress,
  // Excursion concentrated in the first fifth of the fault window.
  spike: (factor, progress) => (progress < 0.2 ? factor : 1 + (factor - 1) * 0.15),
  drain: (factor, progress) => Math.max(1 / factor, 1 - (1 - 1 / factor) * progress),
};

/**
 * The 0..1 shape profile, used by the additive path.
 *
 * Kept separate from RESPONSE rather than refactoring both onto one primitive:
 * the multiplicative expressions must stay exactly as they are, because a
 * last-bit change would rewrite every committed bundle and invalidate every
 * recorded cassette for no behavioural gain.
 */
const PROFILE: Record<Shape, (progress: number) => number> = {
  flat: () => 0,
  step: () => 1,
  ramp: (progress) => progress,
  spike: (progress) => (progress < 0.2 ? 1 : 0.15),
  drain: (progress) => progress,
};

function valueAt(
  spec: SeriesSpec,
  minute: number,
  onset: number,
  end: number,
  rand: Random,
): number {
  const faulted = minute >= onset;
  const progress = faulted
    ? Math.min(1, (minute - onset) / Math.max(1, end - onset))
    : 0;
  const response = spec.after;
  const raw =
    response.delta === undefined
      ? spec.base * (faulted ? RESPONSE[response.shape](response.factor, progress) : 1)
      : spec.base + response.delta * (faulted ? PROFILE[response.shape](progress) : 0);
  const value = rand.jitter(raw, spec.noisePct);
  const precision = spec.precision ?? 2;
  return Number(value.toFixed(precision));
}

export function emitMetrics(
  specs: MetricSpec[],
  window: { minutes: number; onset: number },
  rand: Random,
): MetricSeries[] {
  return specs.map((spec) => ({
    name: spec.name,
    columns: ['ts', ...spec.series.map((s) => s.name)],
    rows: Array.from({ length: window.minutes }, (_, minute) => [
      atMinute(minute),
      ...spec.series.map((s) =>
        valueAt(s, minute, window.onset, window.minutes - 1, rand),
      ),
    ]),
  }));
}

export function toCsv(series: MetricSeries): string {
  const lines = [series.columns.join(',')];
  for (const row of series.rows) lines.push(row.join(','));
  return lines.join('\n') + '\n';
}
