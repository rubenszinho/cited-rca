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
import { detail, progress } from '../progress.ts';
import { searchLog } from './tools.ts';
import { completeJson } from '../llm/structured.ts';
import type { ChatMessage, LlmClient } from '../llm/types.ts';
import { RcaReportSchema, type RcaReport } from '../schema.ts';
import type { IncidentBundle } from '../bundle.ts';
import { describeProblems, verify } from './verify.ts';
import {
  draftMessages,
  investigateMessages,
  NextStepSchema,
  repairMessages,
  triageMessages,
  TriageSchema,
} from './prompt.ts';

/** Log lines returned per search. Enough to see a pattern, not to drown in it. */
const HITS_PER_QUERY = 12;

/** Verification rounds before the draft is emitted as-is. */
const MAX_REPAIRS = 2;

/**
 * Investigation rounds after the opening search.
 *
 * Three is where it stopped paying: by the fourth the queries were rephrasings
 * of ones already run, and the extra call bought nothing but tokens.
 */
const MAX_ROUNDS = 3;

function runSearches(bundle: IncidentBundle, queries: string[]): string {
  const blocks = queries.map((query) => {
    const hits = searchLog(bundle, query, HITS_PER_QUERY);
    detail(`search ${JSON.stringify(query).padEnd(22)} ${hits.length} line(s)`);
    const body = hits.length ? hits.join('\n') : '(no matches)';
    return `--- search "${query}" ---\n${body}`;
  });
  return blocks.join('\n\n');
}

/** Narrate the verifier's verdict and return whether the draft is clean. */
function reportVerification(problems: { where: string }[]): boolean {
  if (problems.length === 0) {
    progress('  verify   every citation resolves');
    return true;
  }
  progress(`  verify   ${problems.length} problem(s), repairing`);
  for (const problem of problems.slice(0, 3)) detail(problem.where);
  return false;
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
    if (reportVerification(problems)) return report;
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

/**
 * Search, read, decide what to search next, repeat.
 *
 * This is the difference between running a fixed set of queries and actually
 * investigating. The opening searches are generic; every round after that is
 * chosen from what the previous round returned, and the loop stops when the
 * workflow says it has enough rather than when a counter runs out.
 */
async function investigate(
  bundle: IncidentBundle,
  client: LlmClient,
  opening: string[],
): Promise<string> {
  const transcript: string[] = [runSearches(bundle, opening)];
  const asked = new Set(opening.map((q) => q.toLowerCase()));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const { value } = await completeJson({
      client,
      step: `agent:investigate${round}:${bundle.caseId}`,
      schema: NextStepSchema,
      messages: investigateMessages(
        bundle,
        transcript.join('\n\n'),
        MAX_ROUNDS - round,
      ),
    });

    // Repeating a query wastes a round and returns text already in context.
    const fresh = value.next_queries.filter((q) => !asked.has(q.toLowerCase()));
    if (fresh.length === 0) break;
    for (const query of fresh) asked.add(query.toLowerCase());
    transcript.push(runSearches(bundle, fresh));
  }
  return transcript.join('\n\n');
}

/** Whichever retrieval strategy this variant has switched on. */
async function gatherEvidence(
  bundle: IncidentBundle,
  client: LlmClient,
  features: Set<string>,
  opening: string[],
): Promise<string> {
  progress('  search   gathering evidence');
  if (!features.has('search')) return '(log search disabled for this variant)';
  if (!features.has('investigate')) return runSearches(bundle, opening);
  return investigate(bundle, client, opening);
}

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
  const searches = await gatherEvidence(bundle, client, features, triage.log_queries);

  const recall = features.has('memory') ? renderRecall(memory.recall(bundle)) : '';
  const messages = draftMessages(bundle, triage, searches, recall);
  const { value: draft } = await completeJson({
    client,
    step: `agent:draft:${bundle.caseId}`,
    schema: RcaReportSchema,
    messages,
  });
  progress('  draft    written');

  const report = features.has('verify')
    ? await repairLoop(client, bundle, messages, draft)
    : draft;
  progress(`  done     cause: ${report.root_cause}`);

  // Remember the conclusion, right or wrong. A memory that only kept the
  // correct ones would be reading the answer key.
  if (features.has('memory')) memory.remember(bundle, report.root_cause);
  return report;
}
