/**
 * Run one incident through one variant and print the review.
 *
 * The evaluation runs all twelve cases and reports numbers; this is for looking
 * at a single result in full - during development, and in the walkthrough video
 * where one realistic execution has to be visible end to end.
 *
 *   task project:dev -- --case 12-batch-job-contention --variant agent
 *   task project:dev -- --list
 */
import { listCases, loadBundle, loadTruth } from './bundle.ts';
import { loadDirectory } from './ingest.ts';
import { verify } from './agent/verify.ts';
import { renderComparison, type Side } from './compare.ts';
import { grade } from './grade.ts';
import { renderMarkdown } from './render.ts';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient, configFromEnv } from './llm/client.ts';
import type { LlmClient } from './llm/types.ts';
import type { RcaReport } from './schema.ts';
import { solveWithAgent } from './agent/solve.ts';
import { solveWithBaseline } from './baseline/solve.ts';
import type { Solver } from './runner.ts';

function argValue(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
}

function solverFor(name: string): Solver {
  if (name === 'agent') return solveWithAgent;
  if (name === 'baseline') return solveWithBaseline;
  throw new Error(`unknown variant "${name}", expected agent or baseline`);
}

function banner(caseId: string, variant: string): void {
  const config = configFromEnv();
  console.log(`case    ${caseId}`);
  console.log(`variant ${variant}`);
  console.log(`model   ${config.model} (${config.mode} mode)`);
  console.log('');
}

function writeReview(caseId: string, markdown: string): string {
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${caseId}.md`);
  writeFileSync(path, markdown, 'utf8');
  return path;
}

function summarise(
  report: RcaReport,
  result: ReturnType<typeof grade>,
  actual: string,
  client: LlmClient,
): void {
  console.log(`root cause   ${report.root_cause}  (actual ${actual})`);
  console.log(`passed       ${result.passed}`);
  console.log(`recall       ${result.evidence_recall}`);
  for (const note of result.notes) console.log(`  - ${note}`);
  console.log(`tokens       ${JSON.stringify(client.totals())}`);
}

/**
 * Run against a real directory, where there is no ground truth to grade.
 *
 * Correctness cannot be scored here - nobody knows the answer. What can still
 * be reported is whether the citations hold up, which is the check that runs in
 * production and the one a reader needs before trusting the document.
 */
async function runDirectory(dir: string, variant: string): Promise<number> {
  const bundle = loadDirectory(dir);
  console.log(`incident ${bundle.caseId}`);
  console.log(`sources  ${bundle.files.map((f) => f.source).join(', ')}\n`);

  const client = createClient();
  const report = await solverFor(variant)(bundle, client);
  const markdown = renderMarkdown(bundle, report);
  console.log(markdown);
  console.log(`review written to ${writeReview(bundle.caseId, markdown)}\n`);

  const problems = verify(bundle, report);
  console.log(
    problems.length === 0
      ? 'every citation resolves against the source files'
      : `${problems.length} citation(s) did not resolve:`,
  );
  for (const problem of problems)
    console.log(`  - ${problem.where}: ${problem.detail}`);
  console.log(`tokens       ${JSON.stringify(client.totals())}`);
  return problems.length === 0 ? 0 : 1;
}

/**
 * Both variants on one incident, so the difference is visible rather than
 * inferred from an aggregate.
 */
async function runComparison(caseId: string): Promise<number> {
  const bundle = loadBundle(caseId);
  const truth = loadTruth(caseId);
  const sides: Side[] = [];

  for (const [label, solver] of [
    ['baseline  (one direct prompt)', solveWithBaseline],
    ['workflow  (search + verify)', solveWithAgent],
  ] as const) {
    const client = createClient();
    const report = await solver(bundle, client);
    sides.push({ label, report, grade: grade(bundle, truth, report) });
  }

  console.log(renderComparison(bundle, truth.root_cause, sides));
  return sides.every((side) => side.grade.passed) ? 0 : 1;
}

/** Modes that do not grade a committed case, dispatched before the default. */
async function alternateMode(): Promise<number | undefined> {
  if (process.argv.includes('--list')) {
    for (const id of listCases()) console.log(`${id}  ${loadTruth(id).title}`);
    return 0;
  }
  const dir = argValue('--dir', '');
  if (dir) return runDirectory(dir, argValue('--variant', 'agent'));
  if (process.argv.includes('--compare')) {
    return runComparison(argValue('--case', listCases()[0] ?? ''));
  }
  return undefined;
}

async function main(): Promise<number> {
  const alternate = await alternateMode();
  if (alternate !== undefined) return alternate;

  const caseId = argValue('--case', listCases()[0] ?? '');
  const variant = argValue('--variant', 'agent');
  banner(caseId, variant);

  const bundle = loadBundle(caseId);
  const client = createClient();
  const report = await solverFor(variant)(bundle, client);
  const result = grade(bundle, loadTruth(caseId), report);

  // The document is the deliverable; the JSON is what the grader reads.
  const markdown = renderMarkdown(bundle, report);
  const path = writeReview(caseId, markdown);
  console.log(
    process.argv.includes('--json') ? JSON.stringify(report, null, 2) : markdown,
  );
  console.log(`\nreview written to ${path}\n`);

  summarise(report, result, loadTruth(caseId).root_cause, client);
  return result.passed ? 0 : 1;
}

process.exit(await main());
