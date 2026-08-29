/**
 * The workflow's self-check, run before a report is emitted.
 *
 * This is the verification step the brief calls out, and it is deliberately
 * deterministic: it catches errors before they reach the user without asking a
 * model to grade a model. It shares `resolve` with the grader, so a draft that
 * satisfies this cannot fail the real citation check afterwards.
 *
 * It cannot see truth.json. It answers "are these citations real and is this
 * argument actually supported", never "is this the right answer". A verifier
 * with access to the answer would be measuring nothing.
 */
import type { IncidentBundle } from '../bundle.ts';
import { describeCitation, resolve } from '../citation.ts';
import type { Finding, RcaReport } from '../schema.ts';

export type Problem = {
  /** Where the draft needs fixing, e.g. "evidence[1].citations[0]". */
  where: string;
  detail: string;
};

function checkFindings(
  bundle: IncidentBundle,
  section: string,
  findings: Finding[],
): Problem[] {
  const problems: Problem[] = [];
  findings.forEach((finding, i) => {
    finding.citations.forEach((citation, j) => {
      if (resolve(bundle, citation) !== undefined) return;
      problems.push({
        where: `${section}[${i}].citations[${j}]`,
        detail:
          `${describeCitation(citation)} does not resolve. Either that line number is ` +
          'wrong or the quote is not on it. Search for the text and cite the line it is on.',
      });
    });
  });
  return problems;
}

const NO_EVIDENCE: Problem = {
  where: 'evidence',
  detail:
    'No evidence given for the named root cause. State why this cause and not another.',
};

// Not a correctness failure, but the case set is built so that every incident
// has a tempting wrong answer. A draft that considered nothing else usually
// took the first plausible signal it saw.
const NOTHING_RULED_OUT: Problem = {
  where: 'ruled_out',
  detail:
    'Nothing was ruled out. Name at least one plausible alternative you rejected ' +
    'and cite the line that rules it out.',
};

/** Checks about the draft's shape rather than about any single citation. */
function checkStructure(report: RcaReport): Problem[] {
  const problems: Problem[] = [];
  if (report.evidence.length === 0) problems.push(NO_EVIDENCE);
  if (report.ruled_out.length === 0) problems.push(NOTHING_RULED_OUT);
  if (Number.isNaN(Date.parse(report.onset_ts))) {
    problems.push({
      where: 'onset_ts',
      detail: `"${report.onset_ts}" is not a timestamp.`,
    });
  }
  return problems;
}

export function verify(bundle: IncidentBundle, report: RcaReport): Problem[] {
  return [
    ...checkFindings(bundle, 'timeline', report.timeline),
    ...checkFindings(bundle, 'evidence', report.evidence),
    ...checkFindings(bundle, 'ruled_out', report.ruled_out),
    ...checkStructure(report),
  ];
}

export function describeProblems(problems: Problem[]): string {
  return problems.map((p) => `- ${p.where}: ${p.detail}`).join('\n');
}
