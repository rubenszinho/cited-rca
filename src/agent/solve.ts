/**
 * The agent workflow: triage, search, draft, verify, repair.
 *
 * Entry point for `task project:agent`.
 *
 * Four things differ from the baseline, and each is meant to be attributable in
 * the changelog rather than bundled into "it is better":
 *
 *   context      metric movement is computed and ranked in code, so the flat
 *                control series is visibly flat instead of sixty rows to read
 *   tools        the log is searched for what triage asked for, rather than
 *                handed over as one fixed slice
 *   orchestration a triage pass decides what to read before anything is written
 *   verification  the draft is checked against the bundle and sent back with
 *                the specific failures until its citations hold up
 */
import { DEFAULT_QUERIES, enabledFeatures } from './features.ts';
import { IncidentMemory, renderRecall } from './memory.ts';
import { searchLog } from './tools.ts';
import { completeJson } from '../llm/structured.ts';
import type { ChatMessage, LlmClient } from '../llm/types.ts';
import { RcaReportSchema, type RcaReport } from '../schema.ts';
import type { IncidentBundle } from '../bundle.ts';
import { describeProblems, verify } from './verify.ts';
import {
  draftMessages,
  repairMessages,
  triageMessages,
  TriageSchema,
} from './prompt.ts';

/** Log lines returned per search. Enough to see a pattern, not to drown in it. */
const HITS_PER_QUERY = 12;

/** Verification rounds before the draft is emitted as-is. */
const MAX_REPAIRS = 2;

function runSearches(bundle: IncidentBundle, queries: string[]): string {
  const blocks = queries.map((query) => {
    const hits = searchLog(bundle, query, HITS_PER_QUERY);
    const body = hits.length ? hits.join('\n') : '(no matches)';
    return `--- search "${query}" ---\n${body}`;
  });
  return blocks.join('\n\n');
}

/**
 * Redraft until the verifier is satisfied or the budget runs out.
 *
 * Emitting the last draft rather than throwing is deliberate: a report with one
 * bad citation is worth more to an on-call than no report, and the grader will
 * record the failure honestly either way.
 */
async function repairLoop(
  client: LlmClient,
  bundle: IncidentBundle,
  messages: ChatMessage[],
  first: RcaReport,
): Promise<RcaReport> {
  let report = first;
  for (let round = 0; round < MAX_REPAIRS; round++) {
    const problems = verify(bundle, report);
    if (problems.length === 0) return report;
    const { value } = await completeJson({
      client,
      step: `agent:repair${round}:${bundle.caseId}`,
      schema: RcaReportSchema,
      messages: repairMessages(
        messages,
        JSON.stringify(report),
        describeProblems(problems),
      ),
    });
    report = value;
  }
  return report;
}

/** Triage, or a fixed stand-in when the triage step is ablated. */
async function triageStep(bundle: IncidentBundle, client: LlmClient, on: boolean) {
  if (!on) {
    return {
      onset_ts: 'unknown',
      reasoning: '(triage disabled for this variant)',
      log_queries: DEFAULT_QUERIES,
    };
  }
  const { value } = await completeJson({
    client,
    step: `agent:triage:${bundle.caseId}`,
    schema: TriageSchema,
    messages: triageMessages(bundle),
  });
  return value;
}

/**
 * Memory lives for the length of a run, not the length of a case.
 *
 * The runner walks the twelve incidents in order on one process, so a
 * module-level store is what "the same engineer, later that week" looks like.
 * Nothing is pre-seeded and nothing survives the process.
 */
const memory = new IncidentMemory();

export async function solveWithAgent(
  bundle: IncidentBundle,
  client: LlmClient,
): Promise<RcaReport> {
  const features = enabledFeatures();
  const triage = await triageStep(bundle, client, features.has('triage'));
  const searches = features.has('search')
    ? runSearches(bundle, triage.log_queries)
    : '(log search disabled for this variant)';

  const recall = features.has('memory') ? renderRecall(memory.recall(bundle)) : '';
  const messages = draftMessages(bundle, triage, searches, recall);
  const { value: draft } = await completeJson({
    client,
    step: `agent:draft:${bundle.caseId}`,
    schema: RcaReportSchema,
    messages,
  });

  const report = features.has('verify')
    ? await repairLoop(client, bundle, messages, draft)
    : draft;

  // Remember the conclusion, right or wrong. A memory that only kept the
  // correct ones would be reading the answer key.
  if (features.has('memory')) memory.remember(bundle, report.root_cause);
  return report;
}
