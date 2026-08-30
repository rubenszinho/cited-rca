/**
 * Does a statement have anything to do with the line it cites?
 *
 * The grader checked that citations resolve and that the required lines were
 * cited. It never looked at the statement text, so a report of pure nonsense —
 * "Badgers operate the load balancer" — citing exactly the right lines with
 * genuine twelve-character quotes scored as fully sound. A reviewer built that
 * report and got 12/12.
 *
 * The attack needs the answer key, which nothing on the solution path can
 * reach, so it was never an exploitable route to a good score. It was worse
 * than that: it was a ceiling on what the number meant. `pass_rate` measured
 * "named the right cause and pointed at the right lines", never "argued it".
 *
 * Full semantic grounding is not available deterministically, and a model
 * judging the argument would put a model back in the grader. Lexical overlap
 * is: a statement that shares no distinctive term with any line it cites is
 * not describing those lines. That does not catch a plausible-but-wrong
 * paraphrase, and it is not meant to — it closes the floor, not the ceiling.
 */
import { resolve } from './citation.ts';
import type { IncidentBundle } from './bundle.ts';
import type { Citation, Finding } from './schema.ts';

/** Terms too common to indicate a statement is about a particular line. */
const STOPWORDS = new Set([
  'that',
  'this',
  'with',
  'from',
  'were',
  'when',
  'which',
  'their',
  'there',
  'have',
  'been',
  'because',
  'after',
  'before',
  'while',
  'during',
  'about',
  'error',
  'errors',
  'incident',
  'onset',
  'started',
  'caused',
  'causing',
  'shows',
  'showing',
  'indicates',
  'service',
  'request',
  'requests',
]);

/** Distinctive lowercase terms of four or more characters. */
export function terms(text: string): Set<string> {
  const found = text.toLowerCase().match(/[a-z][a-z0-9_.-]{3,}/g) ?? [];
  return new Set(found.filter((t) => !STOPWORDS.has(t)));
}

/**
 * What a cited line can reasonably be said to be about.
 *
 * A metric row is entirely numeric, so a statement describing it shares no term
 * with it — "error rate stepped up at onset" against
 * `2026-03-17T09:23:00.000Z,42.9,182,0.09,343`. The header names what those
 * numbers are, so it belongs to the line's meaning even though it is not on it.
 *
 * The file path deliberately does NOT. It was in this context once, and it made
 * the check bypassable in one token: naming the source inside the statement
 * grounds the statement against itself. "Badgers operate the load balancer, per
 * logs/app.jsonl line 645" scored 12/12 sound. That is not an adversarial
 * curiosity — "per metrics/http.csv, latency stepped up" is ordinary phrasing,
 * so every report that cited its sources in prose was auto-grounded and the
 * check was silently off for exactly the reports it was meant to judge. The
 * header carries the naming the path was there for.
 */
function citationContext(
  bundle: IncidentBundle,
  citation: Citation,
  line: string,
): string {
  const file = bundle.files.find((f) => f.source === citation.source);
  const header = file && citation.line > 1 ? (file.lines[0] ?? '') : '';
  return `${line} ${header}`;
}

/**
 * Related if any distinctive term of one contains a distinctive term of the
 * other. Substring rather than equality, because "rate" in a statement is about
 * `error_rate` in a header and exact matching would miss it.
 */
function overlaps(claim: Set<string>, context: Set<string>): boolean {
  for (const a of claim) {
    for (const b of context) {
      if (a.includes(b) || b.includes(a)) return true;
    }
  }
  return false;
}

/**
 * True when the statement shares a distinctive term with something it cites.
 */
export function isGrounded(bundle: IncidentBundle, finding: Finding): boolean {
  const claim = terms(finding.statement);
  if (claim.size === 0) return false;
  return finding.citations.some((citation) => {
    const line = resolve(bundle, citation);
    if (line === undefined) return false;
    return overlaps(claim, terms(citationContext(bundle, citation, line)));
  });
}

/** Findings whose statement is unrelated to everything it cites. */
export function ungrounded(bundle: IncidentBundle, findings: Finding[]): Finding[] {
  return findings.filter((finding) => !isGrounded(bundle, finding));
}
