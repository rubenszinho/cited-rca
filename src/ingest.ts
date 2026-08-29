/**
 * Building an incident bundle from a directory of real telemetry.
 *
 * The twelve committed cases exist so the workflow can be graded. This is how
 * it gets pointed at an actual incident: a directory the user assembled, with
 * whatever they happened to export.
 *
 * Nothing here assumes the fixture layout. An incident bundle is only "a set of
 * text files, each addressable by line" - which is also the entire requirement
 * for citation, since a citation names a file and a line. So any directory of
 * logs, CSVs, or exported JSON works, and the file names the user chose are the
 * source names that appear in the review.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import type { BundleFile, IncidentBundle } from './bundle.ts';

/** Extensions treated as citable telemetry. Anything else is skipped. */
const TEXT_EXTENSIONS = ['.jsonl', '.json', '.log', '.txt', '.csv', '.tsv', '.ndjson'];

/** Skipped wholesale: version control, dependencies, editor state. */
const SKIP_DIRS = new Set(['.git', 'node_modules', '.mise', '.task', '__pycache__']);

/**
 * Per-file line cap.
 *
 * A real log export can be millions of lines. Truncating is honest as long as
 * it is visible, so the bundle records what was dropped rather than silently
 * presenting a partial file as the whole thing.
 */
const MAX_LINES = 20_000;

function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
}

function walk(root: string, dir: string, found: string[]): void {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(root, full, found);
    } else if (isTextFile(entry)) {
      found.push(relative(root, full));
    }
  }
}

function readTruncated(root: string, source: string): BundleFile {
  const text = readFileSync(join(root, source), 'utf8').replace(/\n$/, '');
  const lines = text.split('\n');
  if (lines.length <= MAX_LINES) return { source, lines };
  // The marker occupies a real line number, so every citation above it still
  // addresses the line it did before truncation.
  return {
    source,
    lines: [
      ...lines.slice(0, MAX_LINES),
      `# truncated: ${lines.length - MAX_LINES} further lines not shown`,
    ],
  };
}

/**
 * Read every citable file under `root` into a bundle.
 *
 * @example
 *   const bundle = loadDirectory('./incidents/2026-03-17-checkout');
 *   const report = await solveWithAgent(bundle, createClient());
 */
export function loadDirectory(root: string): IncidentBundle {
  const sources: string[] = [];
  walk(root, root, sources);
  if (sources.length === 0) {
    throw new Error(
      `no telemetry found under ${root}. Expected files ending in ` +
        `${TEXT_EXTENSIONS.join(', ')} - logs, metric exports, change or alert records.`,
    );
  }
  return {
    caseId: root.replace(/\/+$/, '').split('/').pop() ?? root,
    files: sources.map((source) => readTruncated(root, source)),
  };
}
