/**
 * Running one variant across every case and reporting what happened.
 *
 * Both variants share this so they are measured identically: same cases, same
 * order, same grader, same metric definitions. The only thing that differs is
 * the solver passed in.
 *
 * The last line of stdout is a JSON object of metrics, which is the contract
 * harness/run.py reads. Everything else is progress output for a human.
 */
import { listCases, loadBundle, loadTruth, type IncidentBundle } from './bundle.ts';
import { grade, type Grade } from './grade.ts';
import { createClient } from './llm/client.ts';
import type { LlmClient } from './llm/types.ts';
import type { RcaReport } from './schema.ts';

export type Solver = (bundle: IncidentBundle, client: LlmClient) => Promise<RcaReport>;

/** A case that threw counts as a failure, never as a skip. */
function failedGrade(caseId: string, error: unknown): Grade {
  return {
    case_id: caseId,
    passed: false,
    cause_correct: false,
    citations_valid: false,
    evidence_recall: 0,
    red_herring_blamed: false,
    notes: [`solver threw: ${error instanceof Error ? error.message : String(error)}`],
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(4));
}

function costUsd(promptTokens: number, completionTokens: number): number {
  const inRate = Number(process.env.LLM_PRICE_IN_PER_MTOK ?? 0);
  const outRate = Number(process.env.LLM_PRICE_OUT_PER_MTOK ?? 0);
  return Number(
    ((promptTokens * inRate + completionTokens * outRate) / 1e6).toFixed(4),
  );
}

function summarise(grades: Grade[], client: LlmClient, elapsedMs: number) {
  const totals = client.totals();
  return {
    // Primary metric: a case counts only if the cause is right AND the argument
    // for it is sound. See src/grade.ts for the four conditions.
    pass_rate: mean(grades.map((g) => (g.passed ? 1 : 0))),
    cause_accuracy: mean(grades.map((g) => (g.cause_correct ? 1 : 0))),
    citation_validity: mean(grades.map((g) => (g.citations_valid ? 1 : 0))),
    evidence_recall: mean(grades.map((g) => g.evidence_recall)),
    red_herring_rate: mean(grades.map((g) => (g.red_herring_blamed ? 1 : 0))),
    cases: grades.length,
    llm_calls: totals.calls,
    replayed_calls: totals.replayed,
    prompt_tokens: totals.prompt_tokens,
    completion_tokens: totals.completion_tokens,
    cost_usd: costUsd(totals.prompt_tokens, totals.completion_tokens),
    seconds_per_case: Number((elapsedMs / 1000 / grades.length).toFixed(3)),
    // Per-case outcomes travel with the aggregate. "Report every result,
    // including failures" is a rule, and an aggregate alone cannot say which
    // incident a variant lost or why. compare.py ignores non-numeric fields.
    cases_detail: grades.map((g) => ({
      case_id: g.case_id,
      passed: g.passed,
      cause_correct: g.cause_correct,
      citations_valid: g.citations_valid,
      evidence_recall: g.evidence_recall,
      red_herring_blamed: g.red_herring_blamed,
      notes: g.notes,
    })),
  };
}

export async function runVariant(solve: Solver): Promise<void> {
  const client = createClient();
  const grades: Grade[] = [];
  const started = Date.now();

  for (const caseId of listCases()) {
    const bundle = loadBundle(caseId);
    let result: Grade;
    try {
      result = grade(bundle, loadTruth(caseId), await solve(bundle, client));
    } catch (error) {
      result = failedGrade(caseId, error);
    }
    grades.push(result);
    const mark = result.passed ? 'PASS' : 'FAIL';
    console.error(`${mark}  ${caseId}  ${result.notes.join(' | ')}`);
  }

  // stdout carries only the metrics object; progress goes to stderr so the
  // harness can read one without the other.
  console.log(JSON.stringify(summarise(grades, client, Date.now() - started)));
}
