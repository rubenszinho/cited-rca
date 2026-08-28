/**
 * The declarative half of a scenario.
 *
 * A scenario describes a fault; the emitters in this directory turn that
 * description into logs, metrics, changes and alerts. Keeping the description
 * declarative is what lets `truth.json` be derived from the same object that
 * produced the signals, so ground truth cannot drift from the bundle.
 */
import type {
  AlertEvent,
  ChangeEvent,
  EvidenceRef,
  RedHerring,
  RootCause,
} from '../model.ts';

/** How a metric series behaves once the fault starts. */
export type Shape =
  | 'flat' // unaffected — the control series
  | 'step' // jumps to base*factor and stays
  | 'ramp' // climbs linearly to base*factor by the end
  | 'spike' // brief excursion, then back
  | 'drain'; // falls toward base/factor (headroom running out)

export type SeriesSpec = {
  name: string;
  base: number;
  /** Steady-state jitter as a fraction of base. */
  noisePct: number;
  after: { shape: Shape; factor: number };
  /** Integers for counts, 2dp for rates. */
  precision?: number;
};

export type MetricSpec = {
  /** File stem: "latency" -> metrics/latency.csv */
  name: string;
  series: SeriesSpec[];
};

export type LogTemplate = {
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  fields?: Record<string, unknown>;
};

export type LogSpec = {
  /** Steady chatter, present across the whole window. */
  normal: LogTemplate[];
  /** Lines that only appear from onset onward. */
  onFault: (LogTemplate & { ratePerMin: number })[];
  /** Lines per minute of ordinary traffic. */
  normalRatePerMin: number;
};

/** A change or alert placed at a minute offset in the window. */
export type TimedChange = Omit<ChangeEvent, 'ts'> & { minute: number };
export type TimedAlert = Omit<AlertEvent, 'ts'> & { minute: number };

export type Scenario = {
  /** Directory name under fixtures/cases/. */
  id: string;
  title: string;
  rootCause: RootCause;
  summary: string;
  /** Minutes in the window; onset and detection are offsets into it. */
  windowMinutes: number;
  onsetMinute: number;
  detectMinute: number;
  logs: LogSpec;
  metrics: MetricSpec[];
  changes: TimedChange[];
  alerts: TimedAlert[];
  requiredEvidence: EvidenceRef[];
  redHerrings: RedHerring[];
};
