/**
 * Baseline and workflow, on the same incident, side by side.
 *
 * The aggregate says the workflow roughly doubles the pass rate. This shows
 * why, on one case, in a form a person can check: which citations each side
 * produced, and which of them point at a line that does not say what the report
 * claims it says.
 *
 * Reading two full reviews and diffing them by eye is how you miss the point.
 * The difference is not the prose.
 */
import { resolve } from './citation.ts';
import type { IncidentBundle } from './bundle.ts';
import type { Grade } from './grade.ts';
import type { Citation, RcaReport } from './schema.ts';

export type Side = {
  label: string;
  report: RcaReport;
  grade: Grade;
};

function allCitations(report: RcaReport): Citation[] {
  return [...report.timeline, ...report.evidence, ...report.ruled_out].flatMap(
    (finding) => finding.citations,
  );
}

function broken(bundle: IncidentBundle, report: RcaReport): Citation[] {
  return allCitations(report).filter((c) => resolve(bundle, c) === undefined);
}

function verdict(side: Side, actual: string): string {
  const mark = side.grade.passed ? 'PASS' : 'FAIL';
  const cause = side.grade.cause_correct
    ? side.report.root_cause
    : `${side.report.root_cause} (actual ${actual})`;
  return `${mark}  cause: ${cause}`;
}

function citationLine(bundle: IncidentBundle, report: RcaReport): string {
  const all = allCitations(report);
  const bad = broken(bundle, report);
  const suffix = bad.length === 0 ? 'all resolve' : `${bad.length} do NOT resolve`;
  return `${all.length} citations, ${suffix}`;
}

/** The lines a report claimed exist, that do not. The heart of the comparison. */
function fabrications(bundle: IncidentBundle, report: RcaReport): string[] {
  return broken(bundle, report).map((c) => {
    const file = bundle.files.find((f) => f.source === c.source);
    const line = file?.lines[c.line - 1];
    const why = line === undefined ? 'no such line' : `line says: ${line.slice(0, 78)}`;
    return `      ${c.source}:${c.line} claimed "${c.quote.slice(0, 52)}"\n        ${why}`;
  });
}

export function renderComparison(
  bundle: IncidentBundle,
  actual: string,
  sides: Side[],
): string {
  const out = [`incident ${bundle.caseId}`, ''];
  for (const side of sides) {
    out.push(`  ${side.label}`);
    out.push(`    ${verdict(side, actual)}`);
    out.push(`    ${citationLine(bundle, side.report)}`);
    const bad = fabrications(bundle, side.report);
    if (bad.length) out.push(...bad);
    if (side.grade.notes.length) {
      for (const note of side.grade.notes.slice(0, 3))
        out.push(`    - ${note.slice(0, 96)}`);
    }
    out.push('');
  }
  return out.join('\n');
}
