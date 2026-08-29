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
import { createClient, configFromEnv } from './llm/client.ts';
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

  console.log(JSON.stringify(report, null, 2));
  console.log('');
  console.log(
    `root cause   ${report.root_cause}  (actual ${loadTruth(caseId).root_cause})`,
  );
  console.log(`passed       ${result.passed}`);
  console.log(`recall       ${result.evidence_recall}`);
  for (const note of result.notes) console.log(`  - ${note}`);
  console.log(`tokens       ${JSON.stringify(client.totals())}`);
  return result.passed ? 0 : 1;
}

process.exit(await main());
