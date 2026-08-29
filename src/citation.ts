/**
 * Resolving a citation against a bundle.
 *
 * Shared deliberately. The grader uses this to decide whether a report's
 * citations hold up, and the workflow's verifier uses the same function to
 * check its own draft before emitting it. If they were separate
 * implementations they would drift, and the workflow would start passing its
 * own checks while failing the real one.
 *
 * Nothing here can see truth.json, which is what makes it honest for the
 * workflow to run: it is checking that its citations are real, not whether its
 * answer is right.
 */
import { findFile, type IncidentBundle } from './bundle.ts';
import type { Citation } from './schema.ts';

/**
 * The text a citation points at, or undefined if the citation does not hold up.
 *
 * A citation resolves only when the file exists, the line exists, and the
 * quoted text is actually on it. The quote check is what separates a real
 * reference from a plausible-looking line number.
 */
export function resolve(
  bundle: IncidentBundle,
  citation: Citation,
): string | undefined {
  const line = findFile(bundle, citation.source)?.lines[citation.line - 1];
  if (line === undefined || !line.includes(citation.quote)) return undefined;
  return line;
}

export function describeCitation(citation: Citation): string {
  return `${citation.source}:${citation.line} ~ "${citation.quote}"`;
}
