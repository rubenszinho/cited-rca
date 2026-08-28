/**
 * The RCA the workflow emits, and the contract that makes it gradeable.
 *
 * Two decisions here carry the whole evaluation:
 *
 * 1. `root_cause` is an enum, not prose. "Did it find the cause" becomes a
 *    string comparison that a judge reruns and gets the same answer, with no
 *    model in the grading loop.
 *
 * 2. Every finding carries citations pointing at a file and a 1-indexed line in
 *    the bundle. That turns "connect every claim to the evidence" from a
 *    promise in the write-up into something the grader mechanically checks.
 */
import { z } from 'zod';

import { ROOT_CAUSES } from '../fixtures/model.ts';

export const CitationSchema = z.object({
  /** Bundle-relative path, e.g. "logs/app.jsonl" or "metrics/http.csv". */
  source: z.string().min(1),
  /** 1-indexed line within that file. */
  line: z.number().int().positive(),
});

export const FindingSchema = z.object({
  statement: z.string().min(1),
  citations: z.array(CitationSchema).min(1),
});

export const RcaReportSchema = z.object({
  root_cause: z.enum(ROOT_CAUSES),
  summary: z.string().min(1),
  onset_ts: z.string().min(1),
  /** What happened, in order. */
  timeline: z.array(FindingSchema),
  /** Why the named cause is the cause. Graded for evidence recall. */
  evidence: z.array(FindingSchema),
  /**
   * Plausible causes considered and rejected. Citing a red herring here is
   * correct RCA practice, so the grader treats it as a rule-out rather than
   * as blaming it.
   */
  ruled_out: z.array(FindingSchema),
  action_items: z.array(z.string().min(1)),
});

export type Citation = z.infer<typeof CitationSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type RcaReport = z.infer<typeof RcaReportSchema>;
