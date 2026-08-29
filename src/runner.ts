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
import { configFromEnv, createClient } from './llm/client.ts';
import type { LlmClient } from './llm/types.ts';
import type { RcaReport } from './schema.ts';

export type Solver = (bundle: IncidentBundle, client: LlmClient) => Promise<RcaReport>;

/**
 * A case that threw counts as a failure, never as a skip.
 *
 * `outcome: 'invalid'` rather than a wrong answer: nothing parseable came back,
 * so there is no diagnosis to be right or wrong about. Reporting it as a wrong
 * cause would make "the model cannot write JSON" indistinguishable from "the
 * model cannot read telemetry", and on a weaker model the first quietly becomes
 * most of the second.
 */
function failedGrade(caseId: string, error: unknown): Grade {
  return {
    case_id: caseId,
    outcome: 'invalid',
    passed: false,
    report_produced: false,
    cause_correct: false,
    citations_valid: false,
    citations_total: 0,
    citations_resolved: 0,
    evidence_recall: 0,
    red_herring_blamed: false,
    notes: [`solver threw: ${error instanceof Error ? error.message : String(error)}`],
  };
}

/**
 * Did this case fail because of the setup rather than the workflow?
 *
 * The distinction has to survive into the metrics. An exhausted account and a
 * workflow that cannot reason both show up as a zero pass rate, and the
 * aggregate alone cannot tell them apart - a run that ran out of credits
 * halfway produced a clean-looking 0.000 that read as a finding.
 *
 * The list covers everything that is not the workflow's fault: the provider
 * refusing, and the run being misconfigured. A missing key was originally not
 * on it, so a run launched without the environment loaded reported eleven
 * honest-looking failures and one infrastructure error.
 */
const INFRASTRUCTURE = [
  /\b(401|402|403|429|5\d\d)\b/,
  /credits|rate.?limit|quota/i,
  /API_KEY is unset/i,
  /cassette miss/i,
  /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND/i,
];

export function isProviderError(grade: Grade): boolean {
  return grade.notes.some(
    (note) =>
      note.includes('solver threw') && INFRASTRUCTURE.some((rx) => rx.test(note)),
  );
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

/**
 * Mean over the cases that produced a report.
 *
 * Conditioning matters: a schema failure is not evidence that the model chose
 * the wrong cause, and averaging it in as a zero makes a reasoning metric move
 * when only the JSON changed. `completion_rate` carries that loss separately,
 * so nothing is hidden by the conditioning.
 */
function meanOfProduced(grades: Grade[], pick: (g: Grade) => number): number {
  const produced = grades.filter((g) => g.report_produced);
  return produced.length === 0 ? 0 : mean(produced.map(pick));
}

/** How many cases ended in each tier. The shape of a variant's failure. */
function countOutcomes(grades: Grade[]) {
  return {
    sound: grades.filter((g) => g.outcome === 'sound').length,
    unsupported: grades.filter((g) => g.outcome === 'unsupported').length,
    wrong_cause: grades.filter((g) => g.outcome === 'wrong-cause').length,
    invalid: grades.filter((g) => g.outcome === 'invalid').length,
  };
}

function citationTotals(grades: Grade[]): { cited: number; resolved: number } {
  return {
    cited: grades.reduce((n, g) => n + g.citations_total, 0),
    resolved: grades.reduce((n, g) => n + g.citations_resolved, 0),
  };
}

function summarise(grades: Grade[], client: LlmClient, elapsedMs: number) {
  const totals = client.totals();
  const providerErrors = grades.filter(isProviderError).length;
  const { cited, resolved } = citationTotals(grades);
  return {
    /**
     * Cases lost to the provider, not to the workflow. Any value above zero
     * makes every other number here unreliable, and compare.py says so rather
     * than quietly averaging them in.
     */
    provider_errors: providerErrors,
    // Primary metric: a case counts only if the cause is right AND the argument
    // for it is sound. See src/grade.ts for the four conditions.
    pass_rate: mean(grades.map((g) => (g.passed ? 1 : 0))),
    /** Cases that returned a parseable report at all. */
    completion_rate: mean(grades.map((g) => (g.report_produced ? 1 : 0))),
    // The four below are conditioned on a report existing, so they measure
    // reasoning rather than JSON compliance. completion_rate carries the rest.
    cause_accuracy: meanOfProduced(grades, (g) => (g.cause_correct ? 1 : 0)),
    citation_validity: meanOfProduced(grades, (g) => (g.citations_valid ? 1 : 0)),
    /** Citations that resolve over citations made, across every report. One
     *  bad citation in twenty-eight is not the same failure as twenty-eight. */
    citation_precision: cited === 0 ? 0 : Number((resolved / cited).toFixed(4)),
    evidence_recall: meanOfProduced(grades, (g) => g.evidence_recall),
    red_herring_rate: meanOfProduced(grades, (g) => (g.red_herring_blamed ? 1 : 0)),
    outcomes: countOutcomes(grades),
    cases: grades.length,
    model: configFromEnv().model,
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
      outcome: g.outcome,
      passed: g.passed,
      cause_correct: g.cause_correct,
      citations_valid: g.citations_valid,
      evidence_recall: g.evidence_recall,
      red_herring_blamed: g.red_herring_blamed,
      notes: g.notes,
    })),
  };
}

/** Grade one case, turning any throw into an honest failure rather than a skip. */
async function runCase(
  caseId: string,
  solve: Solver,
  client: LlmClient,
): Promise<Grade> {
  const bundle = loadBundle(caseId);
  try {
    return grade(bundle, loadTruth(caseId), await solve(bundle, client));
  } catch (error) {
    return failedGrade(caseId, error);
  }
}

export async function runVariant(solve: Solver): Promise<void> {
  const client = createClient();
  const grades: Grade[] = [];
  const started = Date.now();

  for (const caseId of listCases()) {
    const result = await runCase(caseId, solve, client);
    grades.push(result);
    console.error(
      `${result.passed ? 'PASS' : 'FAIL'}  ${caseId}  ${result.notes.join(' | ')}`,
    );
  }

  const summary = summarise(grades, client, Date.now() - started);
  if (summary.provider_errors > 0) {
    console.error(
      `\nWARNING: ${summary.provider_errors}/${grades.length} cases failed at the ` +
        'provider, not in the workflow. These numbers are not a measurement of ' +
        'anything - fix the account and re-run.',
    );
  }
  // stdout carries only the metrics object; progress goes to stderr so the
  // harness can read one without the other.
  console.log(JSON.stringify(summary));
}
