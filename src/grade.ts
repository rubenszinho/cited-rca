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
import type { IncidentBundle } from './bundle.ts';
import { describeCitation, resolve } from './citation.ts';
import type { Citation, Finding, RcaReport } from './schema.ts';

/**
 * How a case ended, as one word.
 *
 * The original grader had one boolean and could not tell these apart. A report
 * that failed schema validation scored exactly like a confident wrong
 * diagnosis, so "the model cannot write JSON" and "the model cannot read
 * telemetry" landed in the same number - and on a weaker model the first
 * silently became most of the second.
 */
export type Outcome =
  /** No parseable report. The workflow produced nothing to review. */
  | 'invalid'
  /** A report, naming the wrong cause. */
  | 'wrong-cause'
  /** Right cause, but the argument does not hold: bad citations, missing
   *  evidence, or a red herring used as support. */
  | 'unsupported'
  /** Right cause, every citation resolves, every required line cited, no
   *  herring leaned on. */
  | 'sound';

export type Grade = {
  case_id: string;
  outcome: Outcome;
  /** `outcome === 'sound'`. The headline metric. */
  passed: boolean;
  /** False only when nothing parseable came back. */
  report_produced: boolean;
  cause_correct: boolean;
  citations_valid: boolean;
  /** Citations that resolve, over citations made. Coarse booleans hid the
   *  difference between one bad citation and twenty. */
  citations_total: number;
  citations_resolved: number;
  evidence_recall: number;
  red_herring_blamed: boolean;
  /** Human-readable reasons the case failed, for the report and the video. */
  notes: string[];
};

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
  const notes = causeCorrect
    ? []
    : [`cause: said ${report.root_cause}, actual ${truth.root_cause}`];
  return [
    ...notes,
    ...found.unresolved.map((c) => `citation does not resolve: ${describeCitation(c)}`),
    ...found.missing.map(
      (ref) => `evidence not cited: ${ref.source} ~ "${ref.match}" (${ref.why})`,
    ),
    ...found.blamed.map(
      (h) => `red herring used as evidence: "${h.match}" (${h.why_tempting})`,
    ),
  ];
}

type Findings = {
  unresolved: Citation[];
  missing: EvidenceRef[];
  blamed: RedHerring[];
  recall: number;
};

/** Everything the four pass conditions are decided from. */
function assess(bundle: IncidentBundle, truth: Truth, report: RcaReport): Findings {
  // Recall is measured against the sections that argue for the cause, not
  // against ruled_out: supporting evidence has to appear where the argument is.
  const supporting = citedLines(
    bundle,
    citationsOf([...report.timeline, ...report.evidence]),
  );
  const missing = missingEvidence(supporting, truth);
  const required = truth.required_evidence.length;
  const ruledOut = citedLines(bundle, citationsOf(report.ruled_out));
  return {
    unresolved: unresolvedCitations(bundle, report),
    missing,
    blamed: blamedHerrings(supporting, ruledOut, truth),
    recall: required === 0 ? 1 : 1 - missing.length / required,
  };
}

/** All four pass conditions met: right cause, and an argument that holds. */
function isSound(causeCorrect: boolean, found: Findings): boolean {
  return (
    causeCorrect &&
    found.unresolved.length === 0 &&
    found.recall === 1 &&
    found.blamed.length === 0
  );
}

export function grade(bundle: IncidentBundle, truth: Truth, report: RcaReport): Grade {
  const causeCorrect = report.root_cause === truth.root_cause;
  const found = assess(bundle, truth, report);
  const all = [...report.timeline, ...report.evidence, ...report.ruled_out];
  const total = citationsOf(all).length;
  const sound = isSound(causeCorrect, found);

  return {
    case_id: truth.case_id,
    outcome: sound ? 'sound' : causeCorrect ? 'unsupported' : 'wrong-cause',
    passed: sound,
    report_produced: true,
    cause_correct: causeCorrect,
    citations_valid: found.unresolved.length === 0,
    citations_total: total,
    citations_resolved: total - found.unresolved.length,
    evidence_recall: Number(found.recall.toFixed(4)),
    red_herring_blamed: found.blamed.length > 0,
    notes: describe(causeCorrect, report, truth, found),
  };
}
