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

async function main(): Promise<number> {
  if (process.argv.includes('--list')) {
    for (const id of listCases()) console.log(`${id}  ${loadTruth(id).title}`);
    return 0;
  }

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
