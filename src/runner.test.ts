/**
 * Tests for the run summary.
 *
 * One property carries the rest: a failure caused by the setup must never be
 * indistinguishable from a failure caused by the workflow. Both produce a zero
 * pass rate, and reading one as the other has already cost me two hours in this
 * project - once on an exhausted account, once on an unloaded environment.
 */
import { describe, expect, it } from 'vitest';

import { isProviderError } from './runner.ts';
import type { Grade } from './grade.ts';

function graded(note: string): Grade {
  return {
    case_id: 'x',
    outcome: 'invalid',
    passed: false,
    report_produced: false,
    cause_correct: false,
    citations_valid: false,
    citations_total: 0,
    citations_resolved: 0,
    evidence_recall: 0,
    red_herring_blamed: false,
    statements_grounded: false,
    notes: [note],
  };
}

describe('isProviderError', () => {
  it.each([
    ['402 credits', 'solver threw: model returned 402: exceeds your available credits'],
    ['429', 'solver threw: model returned 429: rate limited'],
    ['503', 'solver threw: model returned 503: upstream unavailable'],
    [
      'missing key',
      'solver threw: LLM_API_KEY is unset and step "x" needs a live call.',
    ],
    ['cassette miss', 'solver threw: cassette miss for step "agent:draft" (key abc).'],
    ['network', 'solver threw: fetch failed'],
  ])('flags %s as infrastructure', (_label, note) => {
    expect(isProviderError(graded(note))).toBe(true);
  });

  it.each([
    ['a schema failure', 'solver threw: root_cause: Invalid enum value'],
    ['a parse failure', 'solver threw: response contains no JSON object'],
  ])('does not flag %s, which is the workflow failing', (_label, note) => {
    expect(isProviderError(graded(note))).toBe(false);
  });

  it('does not flag an ordinary graded failure', () => {
    expect(isProviderError(graded('cause: said memory_leak, actual dns_failure'))).toBe(
      false,
    );
  });
});
