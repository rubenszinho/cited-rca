/**
 * Tests for the grader.
 *
 * The grader decides the headline number, so a bug here would quietly change
 * the result rather than fail loudly. Each test pins one way a report can be
 * wrong, including the three that matter most: a right answer with no
 * supporting evidence, a right answer built on the red herring, and a citation
 * whose quote was never on the line it names.
 */
import { describe, expect, it } from 'vitest';

import { loadBundle, loadTruth } from './bundle.ts';
import { grade } from './grade.ts';
import type { Citation, RcaReport } from './schema.ts';

const CASE_ID = '01-bad-deploy-null-deref';
const bundle = loadBundle(CASE_ID);
const truth = loadTruth(CASE_ID);

/** A citation to the first line of `source` containing `needle`, quoting it. */
function cite(source: string, needle: string): Citation {
  const file = bundle.files.find((f) => f.source === source);
  if (!file) throw new Error(`no such bundle file: ${source}`);
  const index = file.lines.findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`"${needle}" not found in ${source}`);
  return { source, line: index + 1, quote: needle };
}

const DEPLOY = () => cite('changes.jsonl', 'v2026.3.17-a1');
const HERRING = () => cite('changes.jsonl', 'v2026.3.16-f3');

function report(overrides: Partial<RcaReport> = {}): RcaReport {
  return {
    root_cause: 'bad_deploy_regression',
    summary: 'The 09:22 checkout release dereferenced a null discount.',
    onset_ts: truth.onset_ts,
    timeline: [
      {
        statement: 'Release v2026.3.17-a1 went out one minute before onset.',
        citations: [DEPLOY()],
      },
    ],
    evidence: [
      {
        statement: 'Guest checkouts raised a TypeError on percentOff.',
        citations: [cite('logs/app.jsonl', "reading 'percentOff'")],
      },
      {
        statement: 'Error rate stepped up at onset.',
        // The metric row at onset, not the header: a column name proves nothing.
        citations: [cite('metrics/http.csv', truth.onset_ts)],
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
    // The failure this whole design exists to catch: a confident,
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
            citations: [{ source: 'changes.jsonl', line: 9999, quote: 'anything' }],
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
            citations: [{ source: 'logs/ghost.jsonl', line: 1, quote: 'anything' }],
          },
        ],
      }),
    );
    expect(result.citations_valid).toBe(false);
  });

  it('rejects a citation whose quote is not on the line it names', () => {
    // A real line number carrying fabricated content. Without the quote check
    // this report would score as fully cited.
    const result = grade(
      bundle,
      truth,
      report({
        timeline: [
          {
            statement: 'The deploy disabled the discount service.',
            citations: [{ ...DEPLOY(), quote: 'disabled the discount service' }],
          },
        ],
      }),
    );
    expect(result.citations_valid).toBe(false);
    expect(result.notes.join(' ')).toContain('disabled the discount service');
  });

  it('flags the red herring when it is used as supporting evidence', () => {
    const withHerring = report();
    withHerring.evidence.push({
      statement: 'An earlier deploy also touched checkout.',
      citations: [HERRING()],
    });
    const result = grade(bundle, truth, withHerring);
    expect(result.red_herring_blamed).toBe(true);
    expect(result.passed).toBe(false);
  });

  it('accepts the red herring when it is explicitly ruled out', () => {
    const withRuleOut = report();
    withRuleOut.evidence.push({
      statement: 'An earlier deploy also touched checkout.',
      citations: [HERRING()],
    });
    withRuleOut.ruled_out.push({
      statement:
        'v2026.3.16-f3 landed 19 minutes before onset, so it is not the trigger.',
      citations: [HERRING()],
    });
    const result = grade(bundle, truth, withRuleOut);
    expect(result.red_herring_blamed).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('never reads truth through the bundle loader', () => {
    // The solution path uses loadBundle; if truth.json ever appeared there, a
    // workflow could read the answer straight out of its input.
    expect(bundle.files.map((f) => f.source)).not.toContain('truth.json');
  });
});
