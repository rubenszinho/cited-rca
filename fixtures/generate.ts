/**
 * Build the synthetic incident bundles.
 *
 * The bundles are committed so a judge evaluates exactly what was measured, and
 * regenerable so nobody has to take that on trust: `--check` rebuilds them in
 * memory and fails if a byte differs from what is on disk.
 *
 * truth.json lives inside each case directory but is never handed to the
 * workflow. `loadCase()` in src/ reads the bundle; only the grader reads truth.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Bundle, EvidenceRef } from './model.ts';
import { Random } from './rng.ts';
import { SCENARIOS } from './scenarios/index.ts';
import { emitAlerts, emitChanges } from './synth/events.ts';
import { emitLogs, toJsonl } from './synth/logs.ts';
import { emitMetrics, toCsv } from './synth/metrics.ts';
import type { Scenario } from './synth/spec.ts';
import { atMinute } from './synth/timeline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, 'cases');

/**
 * Sentinel for "the metric row at onset".
 *
 * A metric series is named only in the CSV header, so requiring the column name
 * as evidence would require citing a header row - which proves nothing and is
 * not what an engineer would point at. The row at onset is the line that
 * actually shows the change, and it is deterministic because the window start
 * is fixed.
 */
const ONSET_SENTINEL = '$onset';

function resolveEvidence(scenario: Scenario): EvidenceRef[] {
  const onset = atMinute(scenario.onsetMinute);
  return scenario.requiredEvidence.map((ref) =>
    ref.match === ONSET_SENTINEL ? { ...ref, match: onset } : ref,
  );
}

function build(scenario: Scenario): Bundle {
  // One stream per case, seeded from the id: adding a case never shifts the
  // bytes of any other one.
  const rand = new Random(scenario.id);
  const window = { minutes: scenario.windowMinutes, onset: scenario.onsetMinute };
  return {
    truth: {
      case_id: scenario.id,
      title: scenario.title,
      root_cause: scenario.rootCause,
      root_cause_summary: scenario.summary,
      onset_ts: atMinute(scenario.onsetMinute),
      detected_ts: atMinute(scenario.detectMinute),
      required_evidence: resolveEvidence(scenario),
      red_herrings: scenario.redHerrings,
    },
    logs: emitLogs(scenario.logs, window, rand),
    metrics: emitMetrics(scenario.metrics, window, rand),
    changes: emitChanges(scenario.changes),
    alerts: emitAlerts(scenario.alerts),
  };
}

/** Bundle-relative path -> file contents. Paths match truth.required_evidence. */
function render(bundle: Bundle): Map<string, string> {
  const files = new Map<string, string>();
  files.set('logs/app.jsonl', toJsonl(bundle.logs));
  for (const series of bundle.metrics) {
    files.set(`metrics/${series.name}.csv`, toCsv(series));
  }
  files.set('changes.jsonl', toJsonl(bundle.changes));
  files.set('alerts.jsonl', toJsonl(bundle.alerts));
  files.set('truth.json', JSON.stringify(bundle.truth, null, 2) + '\n');
  return files;
}

function writeCase(id: string, files: Map<string, string>): void {
  for (const [rel, contents] of files) {
    const path = join(CASES_DIR, id, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }
}

/** Returns the paths that differ from what is committed. */
function diffCase(id: string, files: Map<string, string>): string[] {
  const drifted: string[] = [];
  for (const [rel, contents] of files) {
    const path = join(CASES_DIR, id, rel);
    let onDisk: string;
    try {
      onDisk = readFileSync(path, 'utf8');
    } catch {
      drifted.push(`${rel} (missing)`);
      continue;
    }
    if (onDisk !== contents) drifted.push(rel);
  }
  return drifted;
}

type CaseIndexEntry = {
  case_id: string;
  title: string;
  log_lines: number;
  metric_series: string[];
};

function indexEntry(scenario: Scenario, bundle: Bundle): CaseIndexEntry {
  return {
    case_id: scenario.id,
    title: scenario.title,
    log_lines: bundle.logs.length,
    metric_series: bundle.metrics.map((m) => m.name),
  };
}

function writeAll(built: Built[], indexJson: string): number {
  for (const { scenario, bundle, files } of built) {
    writeCase(scenario.id, files);
    console.log(
      `${scenario.id}  ${bundle.logs.length} log lines, ${bundle.metrics.length} series`,
    );
  }
  writeFileSync(join(CASES_DIR, 'index.json'), indexJson, 'utf8');
  console.log(`\nwrote ${built.length} case(s) to fixtures/cases/`);
  return 0;
}

function checkAll(built: Built[], indexJson: string): number {
  let drift = 0;
  for (const { scenario, files } of built) {
    const drifted = diffCase(scenario.id, files);
    if (!drifted.length) continue;
    console.error(`DRIFT ${scenario.id}: ${drifted.join(', ')}`);
    drift += drifted.length;
  }
  if (readFileSync(join(CASES_DIR, 'index.json'), 'utf8') !== indexJson) {
    console.error('DRIFT index.json');
    drift++;
  }
  if (drift) {
    console.error(`\n${drift} file(s) differ from a fresh generation.`);
    return 1;
  }
  console.log(`${built.length} case(s) match a fresh generation.`);
  return 0;
}

type Built = { scenario: Scenario; bundle: Bundle; files: Map<string, string> };

function main(): number {
  const check = process.argv.includes('--check');
  if (!check) rmSync(CASES_DIR, { recursive: true, force: true });

  const built: Built[] = SCENARIOS.map((scenario) => {
    const bundle = build(scenario);
    return { scenario, bundle, files: render(bundle) };
  });
  const indexJson =
    JSON.stringify(
      built.map((b) => indexEntry(b.scenario, b.bundle)),
      null,
      2,
    ) + '\n';

  return check ? checkAll(built, indexJson) : writeAll(built, indexJson);
}

process.exit(main());
