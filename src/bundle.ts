/**
 * Reading an incident bundle.
 *
 * `loadBundle` deliberately does not read truth.json. The workflow and the
 * baseline both go through this function, so neither can see the answer even by
 * accident; only the grader opens truth.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Truth } from '../fixtures/model.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CASES_DIR = join(HERE, '..', 'fixtures', 'cases');

/** One bundle file, split into 1-indexed lines so citations can address them. */
export type BundleFile = {
  /** Bundle-relative path, the same string a citation must use. */
  source: string;
  lines: string[];
};

export type IncidentBundle = {
  /** Directory name. Bookkeeping only — never shown to a model. */
  caseId: string;
  /**
   * What the model is told the incident is called.
   *
   * The case directories are named after the fault they contain
   * (`05-connection-pool-exhaustion`), which is a description of the answer. A
   * prompt that opened with the case id was handing over the root cause in its
   * first line, and `cause_accuracy` was partly measuring string overlap with a
   * directory name rather than diagnosis.
   *
   * Graded cases therefore get an opaque handle. A real directory keeps its own
   * name: the user chose it, it is context rather than a leak, and hiding it
   * would make the review harder to file.
   */
  handle: string;
  files: BundleFile[];
};

/** Stable opaque handle for a graded case. Same id, same handle, always. */
export function opaqueHandle(caseId: string): string {
  let h = 2166136261;
  for (let i = 0; i < caseId.length; i++) {
    h ^= caseId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `incident-${(h >>> 0).toString(16).padStart(8, '0').slice(0, 6)}`;
}

export function listCases(): string[] {
  const index = JSON.parse(readFileSync(join(CASES_DIR, 'index.json'), 'utf8'));
  return (index as { case_id: string }[]).map((entry) => entry.case_id);
}

function readLines(root: string, source: string): BundleFile {
  const text = readFileSync(join(root, source), 'utf8');
  // A trailing newline would otherwise show up as a citable empty last line.
  return { source, lines: text.replace(/\n$/, '').split('\n') };
}

export function loadBundle(caseId: string): IncidentBundle {
  const root = join(CASES_DIR, caseId);
  const sources = ['logs/app.jsonl', 'changes.jsonl', 'alerts.jsonl'];
  for (const name of readdirSync(join(root, 'metrics')).sort()) {
    sources.push(`metrics/${name}`);
  }
  return {
    caseId,
    handle: opaqueHandle(caseId),
    files: sources.map((source) => readLines(root, source)),
  };
}

/** Grader-only. Nothing on the solution path may call this. */
export function loadTruth(caseId: string): Truth {
  return JSON.parse(readFileSync(join(CASES_DIR, caseId, 'truth.json'), 'utf8'));
}

export function findFile(
  bundle: IncidentBundle,
  source: string,
): BundleFile | undefined {
  return bundle.files.find((file) => file.source === source);
}
