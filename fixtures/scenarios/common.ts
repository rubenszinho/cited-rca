/**
 * Chatter shared by every scenario.
 *
 * The steady-state lines are the noise a real on-call scrolls past. They exist
 * so the workflow has to locate the signal rather than being handed it, and so
 * a citation to "the error line" is a claim about a specific line number in a
 * file of two thousand.
 */
import type { LogTemplate, MetricSpec, SeriesSpec } from '../synth/spec.ts';

export const CHATTER: LogTemplate[] = [
  {
    service: 'api',
    level: 'info',
    msg: 'request completed',
    fields: { req: '$id', ms: '$ms', status: 200 },
  },
  {
    service: 'api',
    level: 'info',
    msg: 'request completed',
    fields: { req: '$id', ms: '$ms', status: 204 },
  },
  {
    service: 'api',
    level: 'debug',
    msg: 'auth token verified',
    fields: { req: '$id' },
  },
  {
    service: 'worker',
    level: 'info',
    msg: 'job finished',
    fields: { job: '$id', ms: '$ms' },
  },
  { service: 'worker', level: 'debug', msg: 'queue poll', fields: { depth: 3 } },
  { service: 'db-proxy', level: 'debug', msg: 'query executed', fields: { ms: '$ms' } },
  {
    service: 'checkout',
    level: 'info',
    msg: 'order placed',
    fields: { req: '$id', ms: '$ms' },
  },
];

/**
 * The http series most scenarios share. Callers vary only how far p95 and the
 * error rate move, so those are the two parameters; rps stays flat on purpose
 * as a control that rules out "it was just traffic".
 */
const ramp = (factor: number) => ({ shape: 'ramp' as const, factor });

/** rps stays flat on purpose: a control series that rules out "just traffic". */
const HTTP_CONTROL: SeriesSpec = {
  name: 'rps',
  base: 340,
  noisePct: 0.08,
  after: { shape: 'flat', factor: 1 },
  precision: 0,
};

export function latencyMetric(p95Factor: number, errorFactor: number): MetricSpec {
  return {
    name: 'http',
    series: [
      {
        name: 'p50_ms',
        base: 42,
        noisePct: 0.12,
        after: ramp(Math.max(1, p95Factor / 2)),
      },
      { name: 'p95_ms', base: 180, noisePct: 0.1, after: ramp(p95Factor) },
      {
        name: 'error_rate',
        base: 0.002,
        noisePct: 0.4,
        after: { shape: 'step', factor: errorFactor },
        precision: 4,
      },
      HTTP_CONTROL,
    ],
  };
}
