/**
 * The baseline variant: one direct prompt per incident.
 *
 * Deliberately has no second look. It sees one assembled view of the bundle and
 * answers from it, which is what "one direct prompt with basic instructions"
 * means. It does share the JSON repair turn with the workflow, because a
 * baseline that lost cases to malformed JSON would move the measurement onto
 * plumbing rather than reasoning.
 */
import type { IncidentBundle } from '../bundle.ts';
import { completeJson } from '../llm/structured.ts';
import type { LlmClient } from '../llm/types.ts';
import { RcaReportSchema, type RcaReport } from '../schema.ts';
import { baselineMessages } from './prompt.ts';

export async function solveWithBaseline(
  bundle: IncidentBundle,
  client: LlmClient,
): Promise<RcaReport> {
  const { value } = await completeJson({
    client,
    step: `baseline:${bundle.caseId}`,
    schema: RcaReportSchema,
    messages: baselineMessages(bundle),
  });
  return value;
}
