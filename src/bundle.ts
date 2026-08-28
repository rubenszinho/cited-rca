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
  caseId: string;
  files: BundleFile[];
};

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
  return { caseId, files: sources.map((source) => readLines(root, source)) };
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
