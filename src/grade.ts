/**
 * Deterministic grading.
 *
 * No model grades anything here. Every check below is a string or range
 * comparison, so a judge who reruns the evaluation on the committed bundles
 * gets the committed numbers back. That property is worth more than a richer
 * rubric that nobody can reproduce.
 *
 * A case passes only if all four hold:
 *   - the named root cause matches the fault that was actually injected
 *   - every citation resolves to a real line of a real bundle file
 *   - every piece of required evidence appears on a line the report cited
 *   - no red herring is used to justify the cause (ruling one out is fine)
 *
 * The third check is the one that stops a lucky guess from scoring: naming the
 * right cause for the wrong reasons fails on evidence recall.
 */
import type { EvidenceRef, RedHerring, Truth } from '../fixtures/model.ts';
import { findFile, type IncidentBundle } from './bundle.ts';
import type { Citation, Finding, RcaReport } from './schema.ts';

export type Grade = {
  case_id: string;
  passed: boolean;
  cause_correct: boolean;
  citations_valid: boolean;
  evidence_recall: number;
  red_herring_blamed: boolean;
  /** Human-readable reasons the case failed, for the report and the video. */
  notes: string[];
};

/** The text a citation points at, or undefined if it does not resolve. */
function resolve(bundle: IncidentBundle, citation: Citation): string | undefined {
  const file = findFile(bundle, citation.source);
  return file?.lines[citation.line - 1];
}

function citationsOf(findings: Finding[]): Citation[] {
  return findings.flatMap((finding) => finding.citations);
}

/** Lines the report actually pointed at, keyed by bundle-relative source. */
function citedLines(
  bundle: IncidentBundle,
  citations: Citation[],
): Map<string, string[]> {
  const cited = new Map<string, string[]>();
  for (const citation of citations) {
    const text = resolve(bundle, citation);
    if (text === undefined) continue;
    const forSource = cited.get(citation.source) ?? [];
    forSource.push(text);
    cited.set(citation.source, forSource);
  }
  return cited;
}

/** Both EvidenceRef and RedHerring are matched the same way: source + substring. */
type LineRef = { source: string; match: string };

function isSupported(cited: Map<string, string[]>, ref: LineRef): boolean {
  return (cited.get(ref.source) ?? []).some((line) => line.includes(ref.match));
}

function unresolvedCitations(bundle: IncidentBundle, report: RcaReport): Citation[] {
  const all = citationsOf([
    ...report.timeline,
    ...report.evidence,
    ...report.ruled_out,
  ]);
  return all.filter((citation) => resolve(bundle, citation) === undefined);
}

/** Required evidence that no cited supporting line contains. */
function missingEvidence(
  supporting: Map<string, string[]>,
  truth: Truth,
): EvidenceRef[] {
  return truth.required_evidence.filter((ref) => !isSupported(supporting, ref));
}

/**
 * Red herrings the report leaned on. Citing one under `ruled_out` is correct
 * RCA practice, so a herring only counts as blamed when it appears as
 * supporting evidence and is never ruled out.
 */
function blamedHerrings(
  supporting: Map<string, string[]>,
  ruledOut: Map<string, string[]>,
  truth: Truth,
): RedHerring[] {
  return truth.red_herrings.filter(
    (herring) =>
      isSupported(supporting, herring) &&
      !(ruledOut.get(herring.source) ?? []).some((line) =>
        line.includes(herring.match),
      ),
  );
}

function describe(
  causeCorrect: boolean,
  report: RcaReport,
  truth: Truth,
  found: { unresolved: Citation[]; missing: EvidenceRef[]; blamed: RedHerring[] },
): string[] {
  const notes: string[] = [];
  if (!causeCorrect) {
    notes.push(`cause: said ${report.root_cause}, actual ${truth.root_cause}`);
  }
  for (const c of found.unresolved) {
    notes.push(`citation does not resolve: ${c.source}:${c.line}`);
  }
  for (const ref of found.missing) {
    notes.push(`evidence not cited: ${ref.source} ~ "${ref.match}" (${ref.why})`);
  }
  for (const herring of found.blamed) {
    notes.push(
      `red herring used as evidence: "${herring.match}" (${herring.why_tempting})`,
    );
  }
  return notes;
}

export function grade(bundle: IncidentBundle, truth: Truth, report: RcaReport): Grade {
  const causeCorrect = report.root_cause === truth.root_cause;
  const unresolved = unresolvedCitations(bundle, report);

  // Recall is measured against the sections that argue for the cause, not
  // against ruled_out: supporting evidence has to appear where the argument is.
  const supporting = citedLines(
    bundle,
    citationsOf([...report.timeline, ...report.evidence]),
  );
  const missing = missingEvidence(supporting, truth);
  const required = truth.required_evidence.length;
  const recall = required === 0 ? 1 : 1 - missing.length / required;

  const ruledOut = citedLines(bundle, citationsOf(report.ruled_out));
  const blamed = blamedHerrings(supporting, ruledOut, truth);

  return {
    case_id: truth.case_id,
    passed:
      causeCorrect && unresolved.length === 0 && recall === 1 && blamed.length === 0,
    cause_correct: causeCorrect,
    citations_valid: unresolved.length === 0,
    evidence_recall: Number(recall.toFixed(4)),
    red_herring_blamed: blamed.length > 0,
    notes: describe(causeCorrect, report, truth, { unresolved, missing, blamed }),
  };
}
