/**
 * Tests for the grader.
 *
 * The grader decides the headline number, so a bug here would quietly change
 * the result rather than fail loudly. Each test pins one way a report can be
 * wrong, including the two that matter most: a right answer with no supporting
 * evidence, and a right answer built on the red herring.
 */
import { describe, expect, it } from 'vitest';

import { loadBundle, loadTruth } from './bundle.ts';
import { grade } from './grade.ts';
import type { RcaReport } from './schema.ts';

const CASE_ID = '01-bad-deploy-null-deref';
const bundle = loadBundle(CASE_ID);
const truth = loadTruth(CASE_ID);

/** 1-indexed line number of the first line containing `needle`. */
function lineOf(source: string, needle: string): number {
  const file = bundle.files.find((f) => f.source === source);
  if (!file) throw new Error(`no such bundle file: ${source}`);
  const index = file.lines.findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`"${needle}" not found in ${source}`);
  return index + 1;
}

function report(overrides: Partial<RcaReport> = {}): RcaReport {
  return {
    root_cause: 'bad_deploy_regression',
    summary: 'The 09:22 checkout release dereferenced a null discount.',
    onset_ts: truth.onset_ts,
    timeline: [
      {
        statement: 'Release v2026.3.17-a1 went out one minute before onset.',
        citations: [
          { source: 'changes.jsonl', line: lineOf('changes.jsonl', 'v2026.3.17-a1') },
        ],
      },
    ],
    evidence: [
      {
        statement: 'Guest checkouts raised a TypeError on percentOff.',
        citations: [
          {
            source: 'logs/app.jsonl',
            line: lineOf('logs/app.jsonl', "reading 'percentOff'"),
          },
        ],
      },
      {
        statement: 'Error rate stepped up at onset.',
        citations: [{ source: 'metrics/http.csv', line: 1 }],
      },
    ],
    ruled_out: [],
    action_items: ['Roll back v2026.3.17-a1.'],
    ...overrides,
  };
}

describe('grade', () => {
  it('passes a report that names the cause and cites every required line', () => {
    const result = grade(bundle, truth, report());
    expect(result.notes).toEqual([]);
    expect(result.passed).toBe(true);
    expect(result.evidence_recall).toBe(1);
  });

  it('fails when the named cause is wrong', () => {
    const result = grade(bundle, truth, report({ root_cause: 'memory_leak' }));
    expect(result.cause_correct).toBe(false);
    expect(result.passed).toBe(false);
  });

  it('fails a right answer that cites nothing supporting it', () => {
    // The failure mode this whole design exists to catch: a confident,
    // correct-looking cause with no evidence behind it.
    const result = grade(bundle, truth, report({ timeline: [], evidence: [] }));
    expect(result.cause_correct).toBe(true);
    expect(result.evidence_recall).toBeLessThan(1);
    expect(result.passed).toBe(false);
  });

  it('fails a citation that points past the end of a file', () => {
    const result = grade(
      bundle,
      truth,
      report({
        timeline: [
          {
            statement: 'invented',
            citations: [{ source: 'changes.jsonl', line: 9999 }],
          },
        ],
      }),
    );
    expect(result.citations_valid).toBe(false);
    expect(result.notes.join(' ')).toContain('changes.jsonl:9999');
  });

  it('fails a citation to a file that is not in the bundle', () => {
    const result = grade(
      bundle,
      truth,
      report({
        timeline: [
          {
            statement: 'invented',
            citations: [{ source: 'logs/ghost.jsonl', line: 1 }],
          },
        ],
      }),
    );
    expect(result.citations_valid).toBe(false);
  });

  it('flags the red herring when it is used as supporting evidence', () => {
    const withHerring = report();
    withHerring.evidence.push({
      statement: 'An earlier deploy also touched checkout.',
      citations: [
        { source: 'changes.jsonl', line: lineOf('changes.jsonl', 'v2026.3.16-f3') },
      ],
    });
    const result = grade(bundle, truth, withHerring);
    expect(result.red_herring_blamed).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('accepts the red herring when it is explicitly ruled out', () => {
    const herringLine = lineOf('changes.jsonl', 'v2026.3.16-f3');
    const withRuleOut = report();
    withRuleOut.evidence.push({
      statement: 'An earlier deploy also touched checkout.',
      citations: [{ source: 'changes.jsonl', line: herringLine }],
    });
    withRuleOut.ruled_out.push({
      statement:
        'v2026.3.16-f3 landed 19 minutes before onset, so it is not the trigger.',
      citations: [{ source: 'changes.jsonl', line: herringLine }],
    });
    const result = grade(bundle, truth, withRuleOut);
    expect(result.red_herring_blamed).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('never reads truth through the bundle loader', () => {
    // The solution path uses loadBundle; if truth.json ever appeared there, a
    // workflow could read the answer straight out of the input.
    expect(bundle.files.map((f) => f.source)).not.toContain('truth.json');
  });
});
