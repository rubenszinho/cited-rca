/**
 * Rendering a review a person would put their name on.
 *
 * The workflow's own output is JSON, which is right for grading and useless to
 * the person who has to publish the postmortem. This turns it into the document
 * they actually need: readable top to bottom, and — the part that matters —
 * every claim followed by the telemetry line it rests on, quoted in place.
 *
 * That last property is why the citations are worth carrying. A reviewer does
 * not have to trust the write-up or go spelunking to check it; the evidence is
 * inline, addressed, and copied from the file.
 */
import { resolve } from './citation.ts';
import type { IncidentBundle } from './bundle.ts';
import type { Finding, RcaReport } from './schema.ts';

/** Cited line, or a visible marker when it does not resolve. Never silent. */
function evidenceLine(bundle: IncidentBundle, finding: Finding): string[] {
  const lines: string[] = [];
  for (const citation of finding.citations) {
    const text = resolve(bundle, citation);
    const where = `${citation.source}:${citation.line}`;
    if (text === undefined) {
      // Surfaced rather than dropped: a reader must be able to see that a
      // citation did not hold up, otherwise the document hides its own defect.
      lines.push(
        `> ⚠️ **unverified citation** \`${where}\` — quoted text not found on that line`,
      );
      continue;
    }
    lines.push(`> \`${where}\`  \n> \`${text.trim()}\``);
  }
  return lines;
}

function section(bundle: IncidentBundle, title: string, findings: Finding[]): string[] {
  if (findings.length === 0) return [];
  const out = [`## ${title}`, ''];
  for (const finding of findings) {
    out.push(`- ${finding.statement}`, '');
    out.push(...evidenceLine(bundle, finding), '');
  }
  return out;
}

function humanCause(cause: string): string {
  return cause.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

function head(bundle: IncidentBundle, report: RcaReport): string[] {
  return [
    `# Incident review — ${bundle.caseId}`,
    '',
    `**Root cause:** ${humanCause(report.root_cause)}  `,
    `**Onset:** ${report.onset_ts}`,
    '',
    '## Summary',
    '',
    report.summary,
    '',
  ];
}

function actionItems(items: string[]): string[] {
  if (items.length === 0) return [];
  return ['## Action items', '', ...items.map((item) => `- [ ] ${item}`), ''];
}

const FOOTER = [
  '---',
  '',
  '_Drafted by the cited-RCA workflow. Every quote above was copied from the_',
  '_line it names and checked against the incident bundle before publication._',
  '',
];

export function renderMarkdown(bundle: IncidentBundle, report: RcaReport): string {
  return [
    ...head(bundle, report),
    ...section(bundle, 'What happened', report.timeline),
    ...section(bundle, 'Why this is the cause', report.evidence),
    ...section(bundle, 'Considered and ruled out', report.ruled_out),
    ...actionItems(report.action_items),
    ...FOOTER,
  ].join('\n');
}
