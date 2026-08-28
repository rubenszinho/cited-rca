/**
 * The shape of a synthetic incident bundle and its ground truth.
 *
 * Every case is generated from a fault model, which means the root cause is
 * known exactly rather than being someone's later opinion. That is what makes
 * grading deterministic: no LLM judge, no rubric drift between runs.
 */

/**
 * Closed set of root causes.
 *
 * Deliberately an enum rather than free text. The RCA the workflow emits names
 * one of these, so "did it find the right cause" is a string comparison a judge
 * can rerun and get the same answer. Free-text causes would need a model to
 * grade them, and the grade would move between runs.
 */
export const ROOT_CAUSES = [
  'bad_deploy_regression',
  'resource_exhaustion_pool',
  'memory_leak',
  'downstream_dependency_failure',
  'cache_stampede',
  'disk_exhaustion',
  'config_change',
  'certificate_expiry',
  'dns_failure',
  'upstream_rate_limit',
  'schema_migration_regression',
  'batch_job_contention',
] as const;

export type RootCause = (typeof ROOT_CAUSES)[number];

export type LogLine = {
  ts: string;
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  msg: string;
  [field: string]: unknown;
};

export type ChangeEvent = {
  ts: string;
  kind: 'deploy' | 'flag' | 'scale' | 'migration' | 'batch';
  ref: string;
  actor: string;
  summary: string;
};

export type AlertEvent = {
  ts: string;
  name: string;
  severity: 'page' | 'ticket';
  state: 'firing' | 'resolved';
};

export type MetricSeries = {
  /** File stem under metrics/, e.g. "latency" -> metrics/latency.csv */
  name: string;
  columns: string[];
  rows: (string | number)[][];
};

/**
 * One citation a correct RCA has to produce.
 *
 * `source` is the bundle-relative path; `match` is a substring that must appear
 * on the cited line. Recall against this list is what stops a workflow from
 * scoring well by naming the right cause for the wrong reasons.
 */
export type EvidenceRef = {
  source: string;
  match: string;
  why: string;
};

/** A signal that plausibly explains the incident but did not cause it. */
export type RedHerring = {
  source: string;
  match: string;
  why_tempting: string;
};

export type Truth = {
  case_id: string;
  title: string;
  root_cause: RootCause;
  root_cause_summary: string;
  onset_ts: string;
  detected_ts: string;
  required_evidence: EvidenceRef[];
  red_herrings: RedHerring[];
};

export type Bundle = {
  truth: Truth;
  logs: LogLine[];
  metrics: MetricSeries[];
  changes: ChangeEvent[];
  alerts: AlertEvent[];
};
