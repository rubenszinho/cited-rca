/**
 * Tests for the workflow's self-check.
 *
 * The verifier's value depends entirely on it agreeing with the grader. If it
 * passed a draft the grader would fail, the repair loop would be busywork.
 */
import { describe, expect, it } from 'vitest';

import { loadBundle } from '../bundle.ts';
import type { RcaReport } from '../schema.ts';
import { verify } from './verify.ts';

const bundle = loadBundle('01-bad-deploy-null-deref');

function citation(needle: string) {
  const file = bundle.files.find((f) => f.source === 'changes.jsonl')!;
  const index = file.lines.findIndex((line) => line.includes(needle));
  return { source: 'changes.jsonl', line: index + 1, quote: needle };
}

function report(overrides: Partial<RcaReport> = {}): RcaReport {
  return {
    root_cause: 'bad_deploy_regression',
    summary: 'A release regression.',
    onset_ts: '2026-03-17T09:23:00.000Z',
    timeline: [{ statement: 'deployed', citations: [citation('v2026.3.17-a1')] }],
    evidence: [
      { statement: 'the release did it', citations: [citation('v2026.3.17-a1')] },
    ],
    ruled_out: [
      { statement: 'not the earlier one', citations: [citation('v2026.3.16-f3')] },
    ],
    action_items: ['roll back'],
    ...overrides,
  };
}

describe('verify', () => {
  it('passes a draft whose citations all resolve', () => {
    expect(verify(bundle, report())).toEqual([]);
  });

  it('locates a bad citation precisely enough to repair', () => {
    const bad = report();
    bad.evidence[0]!.citations[0]!.quote = 'never appeared anywhere';
    const problems = verify(bundle, bad);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.where).toBe('evidence[0].citations[0]');
    expect(problems[0]!.detail).toContain('never appeared anywhere');
  });

  it('flags a line number past the end of the file', () => {
    const bad = report();
    bad.timeline[0]!.citations[0]!.line = 99999;
    expect(verify(bundle, bad)[0]!.where).toBe('timeline[0].citations[0]');
  });

  it('flags a cause with no evidence behind it', () => {
    expect(
      verify(bundle, report({ evidence: [] })).some((p) => p.where === 'evidence'),
    ).toBe(true);
  });

  it('flags a draft that ruled nothing out', () => {
    // Every case has a tempting wrong answer; a draft that considered none of
    // them usually took the first plausible signal it saw.
    expect(
      verify(bundle, report({ ruled_out: [] })).some((p) => p.where === 'ruled_out'),
    ).toBe(true);
  });

  it('flags an unparseable onset timestamp', () => {
    expect(verify(bundle, report({ onset_ts: 'this morning' }))[0]!.where).toBe(
      'onset_ts',
    );
  });

  it('cannot see the answer', async () => {
    // The verifier only ever checks that citations are real. If it could read
    // the ground truth it would be grading itself, and the improvement it
    // produces would be an artefact of the harness rather than of the workflow.
    //
    // Comments are stripped first: this file and verify.ts both discuss the
    // ground truth in prose, and matching on prose would make the assertion
    // fire on its own explanation.
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(new URL('./verify.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toContain('loadTruth');
    expect(source).not.toContain('truth');
  });
});
