/**
 * The workflow's orchestration, exercised end to end against a stub model.
 *
 * These tests are about shape, not about answer quality: that the triage pass
 * runs first, that its queries reach the log search, and above all that a draft
 * with a fabricated citation is sent back rather than emitted. That last
 * behaviour is the improvement the changelog claims, so it needs a test that
 * fails if the loop is ever removed.
 */
import { describe, expect, it } from 'vitest';

import { loadBundle } from '../bundle.ts';
import { stubClient } from '../llm/stub.ts';
import type { RcaReport } from '../schema.ts';
import { solveWithAgent } from './solve.ts';

const bundle = loadBundle('01-bad-deploy-null-deref');

function lineOf(source: string, needle: string): number {
  const file = bundle.files.find((f) => f.source === source);
  const index = file?.lines.findIndex((line) => line.includes(needle)) ?? -1;
  if (index < 0) throw new Error(`"${needle}" not found in ${source}`);
  return index + 1;
}

const TRIAGE = JSON.stringify({
  onset_ts: '2026-03-17T09:23:00.000Z',
  reasoning: 'error_rate stepped up while rps stayed flat, so it is not traffic.',
  log_queries: ['percentOff', 'checkout'],
});

function goodReport(): RcaReport {
  return {
    root_cause: 'bad_deploy_regression',
    summary: 'The 09:22 release dereferenced a null discount for guest carts.',
    onset_ts: '2026-03-17T09:23:00.000Z',
    timeline: [
      {
        statement: 'v2026.3.17-a1 deployed one minute before onset.',
        citations: [
          {
            source: 'changes.jsonl',
            line: lineOf('changes.jsonl', 'v2026.3.17-a1'),
            quote: 'v2026.3.17-a1',
          },
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
            quote: "reading 'percentOff'",
          },
        ],
      },
    ],
    ruled_out: [
      {
        statement: 'The earlier v2026.3.16-f3 deploy predates onset by 19 minutes.',
        citations: [
          {
            source: 'changes.jsonl',
            line: lineOf('changes.jsonl', 'v2026.3.16-f3'),
            quote: 'v2026.3.16-f3',
          },
        ],
      },
    ],
    action_items: ['Roll back v2026.3.17-a1.'],
  };
}

describe('solveWithAgent', () => {
  it('triages before drafting and passes its queries to the log search', async () => {
    let draftPrompt = '';
    const client = stubClient((options, index) => {
      if (index === 0) return TRIAGE;
      draftPrompt = options.messages.map((m) => m.content).join('\n');
      return JSON.stringify(goodReport());
    });

    await solveWithAgent(bundle, client);

    expect(client.steps[0]).toContain('triage');
    expect(client.steps[1]).toContain('draft');
    // The searches triage asked for are what the draft step gets to read.
    expect(draftPrompt).toContain('search "percentOff"');
    expect(draftPrompt).toContain('search "checkout"');
  });

  it('emits a clean draft without spending a repair turn', async () => {
    const client = stubClient((_options, index) =>
      index === 0 ? TRIAGE : JSON.stringify(goodReport()),
    );
    const report = await solveWithAgent(bundle, client);
    expect(report.root_cause).toBe('bad_deploy_regression');
    expect(client.steps.filter((s) => s.includes('repair'))).toHaveLength(0);
  });

  it('sends a fabricated citation back with the specific failure', async () => {
    const fabricated = goodReport();
    fabricated.evidence[0]!.citations[0]!.quote = 'the discount service was disabled';

    let repairPrompt = '';
    const client = stubClient((options, index) => {
      if (index === 0) return TRIAGE;
      if (index === 1) return JSON.stringify(fabricated);
      repairPrompt = options.messages.at(-1)?.content ?? '';
      return JSON.stringify(goodReport());
    });

    const report = await solveWithAgent(bundle, client);

    expect(client.steps.some((s) => s.includes('repair'))).toBe(true);
    expect(repairPrompt).toContain('the discount service was disabled');
    expect(repairPrompt).toContain('does not resolve');
    // And the corrected draft is what comes out.
    expect(report.evidence[0]!.citations[0]!.quote).toBe("reading 'percentOff'");
  });

  it('gives up after the repair budget and returns the last draft', async () => {
    const broken = goodReport();
    broken.timeline[0]!.citations[0]!.line = 99999;
    const client = stubClient((_options, index) =>
      index === 0 ? TRIAGE : JSON.stringify(broken),
    );

    const report = await solveWithAgent(bundle, client);

    // A report with one bad citation still helps an on-call more than nothing,
    // and the grader records the failure honestly either way.
    expect(report.timeline[0]!.citations[0]!.line).toBe(99999);
    expect(client.steps.filter((s) => s.includes('repair'))).toHaveLength(2);
  });
});
