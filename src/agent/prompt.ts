/**
 * Prompts for each step of the workflow.
 *
 * The system prompt is shared with the baseline on purpose: the citation rules
 * are part of the task, not part of the improvement being measured. What
 * differs is the context each step is given and the fact that there are steps
 * at all.
 */
import { z } from 'zod';

import type { IncidentBundle } from '../bundle.ts';
import { smallSources } from '../context.ts';
import type { ChatMessage } from '../llm/types.ts';
import { SYSTEM, schemaInstructions } from '../baseline/prompt.ts';
import { metricMoves, type SeriesMove } from './tools.ts';

/** Metric series ranked by movement, so the flat controls sort to the bottom. */
export const MAX_QUERIES = 5;

/**
 * One round of investigation.
 *
 * The workflow reads what its last searches returned and decides what to look
 * at next, the way a person reads a log and then greps for the thing they just
 * noticed. An empty `next_queries` means it has seen enough, which is the
 * decision that makes this a loop rather than a fixed pipeline.
 */
export const NextStepSchema = z.object({
  reasoning: z.string().min(1),
  next_queries: z.array(z.string().min(2)).max(MAX_QUERIES),
});

export type NextStep = z.infer<typeof NextStepSchema>;

export const TriageSchema = z.object({
  onset_ts: z.string().min(1),
  reasoning: z.string().min(1),
  /**
   * Substring searches to run against the log. Asking for these rather than
   * handing over a fixed slice is the point: the workflow chooses what to read.
   */
  log_queries: z.array(z.string().min(2)).min(1).max(MAX_QUERIES),
});

export type Triage = z.infer<typeof TriageSchema>;

function renderMoves(moves: SeriesMove[]): string {
  const rows = moves.map(
    (m) =>
      `${m.source} ${m.series}: first=${m.first} min=${m.min} max=${m.max} ` +
      `last=${m.last} swing=${m.swing_pct}%`,
  );
  return [
    '--- metric movement, largest first (computed, not sampled) ---',
    ...rows,
  ].join('\n');
}

export function triageMessages(bundle: IncidentBundle): ChatMessage[] {
  const user = [
    `Incident ${bundle.caseId}. First pass: work out when it started and what to read.`,
    '',
    ...smallSources(bundle),
    '',
    renderMoves(metricMoves(bundle)),
    '',
    'The application log has thousands of lines and is not shown here. Decide what to',
    'search it for. A series that barely moved is a control: it tells you what the',
    'incident is NOT, which is often the more useful signal.',
    '',
    'Reply with a single JSON object and nothing else:',
    '{',
    '  "onset_ts": "ISO timestamp when the incident began",',
    '  "reasoning": "which series moved, which stayed flat, and what that implies",',
    `  "log_queries": ["substring to search for", ...]  // 1 to ${MAX_QUERIES}`,
    '}',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}

const DRAFT_GUIDANCE = [
  'Name the cause that explains the evidence, not the change that happens to sit',
  'closest to onset. State what you considered and rejected, and cite the line that',
  'rules it out.',
].join('\n');

function draftBody(
  bundle: IncidentBundle,
  triage: Triage,
  searchResults: string,
  recall: string,
): string {
  return [
    `Incident ${bundle.caseId}. Write the review.`,
    '',
    ...smallSources(bundle),
    '',
    renderMoves(metricMoves(bundle)),
    '',
    `--- your triage ---\nonset: ${triage.onset_ts}\n${triage.reasoning}`,
    '',
    searchResults,
    ...(recall ? ['', recall] : []),
    '',
    DRAFT_GUIDANCE,
    '',
    schemaInstructions(),
  ].join('\n');
}

export function draftMessages(
  bundle: IncidentBundle,
  triage: Triage,
  searchResults: string,
  recall = '',
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: draftBody(bundle, triage, searchResults, recall) },
  ];
}

/**
 * Ask what to look at next, given what has been found so far.
 *
 * The evidence is passed back verbatim rather than summarised. Summarising it
 * would lose the line addresses, and an address that never reaches the model is
 * one it cannot cite.
 */
const INVESTIGATE_GUIDANCE = [
  'Decide what to read next. Look for the line that would distinguish between',
  'the causes still open, and for anything that would rule one out. A series',
  'that stayed flat is evidence too.',
].join('\n');

const NEXT_STEP_SHAPE = [
  'Reply with a single JSON object and nothing else:',
  '{',
  '  "reasoning": "what the evidence so far points at, and what is still open",',
  `  "next_queries": ["substring to search the log for", ...]  // 0 to ${MAX_QUERIES}`,
  '}',
].join('\n');

function investigateBody(
  bundle: IncidentBundle,
  found: string,
  roundsLeft: number,
): string {
  return [
    `Incident ${bundle.caseId}. You are working out what happened.`,
    '',
    ...smallSources(bundle),
    '',
    renderMoves(metricMoves(bundle)),
    '',
    '--- what your searches have returned so far ---',
    found,
    '',
    INVESTIGATE_GUIDANCE,
    '',
    `You have ${roundsLeft} more round(s) of searching. Return an empty`,
    'next_queries when you have enough to write the review.',
    '',
    NEXT_STEP_SHAPE,
  ].join('\n');
}

export function investigateMessages(
  bundle: IncidentBundle,
  found: string,
  roundsLeft: number,
): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: investigateBody(bundle, found, roundsLeft) },
  ];
}

export function repairMessages(
  previous: ChatMessage[],
  draft: string,
  problems: string,
): ChatMessage[] {
  return [
    ...previous,
    { role: 'assistant', content: draft },
    {
      role: 'user',
      content: [
        'Your draft was checked against the bundle and these citations do not hold up:',
        '',
        problems,
        '',
        'Every citation must name a line that exists and quote text that is actually on',
        'it. Fix them and reply with the corrected JSON object only.',
      ].join('\n'),
    },
  ];
}
