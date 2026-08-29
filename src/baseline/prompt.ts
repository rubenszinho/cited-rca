/**
 * The baseline's single prompt.
 *
 * This is the brief's own first baseline example — "one direct prompt with
 * basic instructions" — and it is written to be a fair representative of it,
 * not a strawman. It gets the full change and alert timeline, every metric
 * series in full, every error and warning line, and an even sample of the
 * remaining log so its view still spans the whole window.
 *
 * What it does not get is a second look. It sees one assembled view of the
 * bundle and answers from it. That is the difference the experiment measures.
 */
import type { IncidentBundle } from '../bundle.ts';
import { bulkFiles, deduped, sample, smallSources } from '../context.ts';
import type { ChatMessage } from '../llm/types.ts';
import { ROOT_CAUSES } from '../../fixtures/model.ts';
import { MIN_QUOTE } from '../schema.ts';

/** Sampled info/debug lines kept for context around the errors. */
const CONTEXT_SAMPLE = 120;

/** Occurrences kept per distinct error/warning shape. */
const KEEP_PER_SHAPE = 3;

export const SYSTEM = [
  'You are an experienced site reliability engineer writing a post-incident review.',
  '',
  'Every factual statement you make must cite the telemetry line it rests on.',
  'Each line you are shown is prefixed with its address as "source:line| text".',
  'Cite using that exact source string, that exact line number, and a verbatim',
  'quote of text on that line.',
  'Never cite a line you were not shown, and never invent a line number or quote.',
].join('\n');

function logView(bundle: IncidentBundle): string {
  const logs = bulkFiles(bundle)[0];
  if (!logs) return '';
  const problems = deduped(logs, ['error', 'warn'], KEEP_PER_SHAPE);
  const context = sample(logs, CONTEXT_SAMPLE);
  return [
    `--- logs/app.jsonl (${logs.lines.length} lines total) ---`,
    '# every distinct error and warning shape, first occurrences with counts:',
    ...problems,
    '# an even sample of the remaining log, for context:',
    ...context,
  ].join('\n');
}

export function schemaInstructions(): string {
  return [
    'Reply with a single JSON object and nothing else:',
    '{',
    `  "root_cause": one of ${ROOT_CAUSES.join(' | ')},`,
    '  "summary": "what happened, in two or three sentences",',
    '  "onset_ts": "ISO timestamp when the incident began",',
    '  "timeline": [{ "statement": "...", "citations": [{"source": "...", "line": N, "quote": "..."}] }],',
    '  "evidence": [{ "statement": "why this is the cause", "citations": [...] }],',
    '  "ruled_out": [{ "statement": "what you considered and rejected, and why", "citations": [...] }],',
    '  "action_items": ["..."]',
    '}',
    '',
    'Every entry in timeline, evidence and ruled_out needs at least one citation.',
    'In "quote", copy a distinctive fragment of the text that appears on that exact',
    'line, verbatim. A citation whose quote is not on the line it names is rejected.',
    `The quote must be at least ${MIN_QUOTE} characters: it has to name something`,
    'specific enough to be wrong.',
  ].join('\n');
}

export function baselineMessages(bundle: IncidentBundle): ChatMessage[] {
  const user = [
    `Incident ${bundle.handle}. Below is the telemetry collected for it.`,
    '',
    ...smallSources(bundle),
    '',
    logView(bundle),
    '',
    'Determine the root cause and write the review.',
    '',
    schemaInstructions(),
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: user },
  ];
}
