/**
 * The workflow's orchestration, exercised end to end against a stub model.
 *
 * These tests are about shape, not about answer quality: that the triage pass
 * runs first, that its queries reach the log search, and above all that a draft
 * with a fabricated citation is sent back rather than emitted. That last
 * behaviour is the improvement the changelog claims, so it needs a test that
 * fails if the loop is ever removed.
 */
import { afterEach, describe, expect, it } from 'vitest';

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

/** One more round, then stop. */
const INVESTIGATE_MORE = JSON.stringify({
  reasoning: 'the TypeError names a handler; look for the release tag too',
  next_queries: ['v2026.3.17-a1'],
});

/** Nothing further needed. */
const INVESTIGATE_DONE = JSON.stringify({ reasoning: 'enough', next_queries: [] });

/**
 * Respond by step name rather than call index.
 *
 * Indices break every time a step is added to the workflow, and the breakage
 * looks like a logic failure rather than a stale test.
 */
function scripted(overrides: Record<string, string> = {}) {
  return (options: { step: string }) => {
    for (const [needle, response] of Object.entries(overrides)) {
      if (options.step.includes(needle)) return response;
    }
    if (options.step.includes('triage')) return TRIAGE;
    if (options.step.includes('investigate')) return INVESTIGATE_DONE;
    return JSON.stringify(goodReport());
  };
}

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

describe('solveWithAgent (shipped configuration)', () => {
  it('drafts without a triage call and searches with the default queries', async () => {
    // Triage is deliberately not in the default: the ablation showed it lowers
    // both pass rate and cause accuracy. See src/agent/features.ts.
    let draftPrompt = '';
    const respond = scripted();
    const client = stubClient((options) => {
      if (options.step.includes('draft')) {
        draftPrompt = options.messages.map((m) => m.content).join('\n');
      }
      return respond(options);
    });

    await solveWithAgent(bundle, client);

    expect(client.steps.some((s) => s.includes('triage'))).toBe(false);
    expect(client.steps[0]).toContain('investigate');
    expect(draftPrompt).toContain('search "error"');
  });

  it('emits a clean draft without spending a repair turn', async () => {
    const client = stubClient(scripted());
    const report = await solveWithAgent(bundle, client);
    expect(report.root_cause).toBe('bad_deploy_regression');
    expect(client.steps.filter((s) => s.includes('repair'))).toHaveLength(0);
  });

  it('still runs triage when it is switched back on', async () => {
    process.env.AGENT_FEATURES = 'triage,search,verify';
    try {
      let draftPrompt = '';
      const respond = scripted();
      const client = stubClient((options) => {
        if (options.step.includes('draft')) {
          draftPrompt = options.messages.map((m) => m.content).join('\n');
        }
        return respond(options);
      });
      await solveWithAgent(bundle, client);
      expect(client.steps[0]).toContain('triage');
      // The searches triage asked for are what the draft step gets to read.
      expect(draftPrompt).toContain('search "percentOff"');
    } finally {
      delete process.env.AGENT_FEATURES;
    }
  });

  it('sends a fabricated citation back with the specific failure', async () => {
    const fabricated = goodReport();
    fabricated.evidence[0]!.citations[0]!.quote = 'the discount service was disabled';

    let repairPrompt = '';
    let drafted = false;
    const respond = scripted();
    const client = stubClient((options) => {
      if (options.step.includes('repair')) {
        repairPrompt = options.messages.at(-1)?.content ?? '';
        return JSON.stringify(goodReport());
      }
      if (options.step.includes('draft') && !drafted) {
        drafted = true;
        return JSON.stringify(fabricated);
      }
      return respond(options);
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
    const client = stubClient(
      scripted({ draft: JSON.stringify(broken), repair: JSON.stringify(broken) }),
    );

    const report = await solveWithAgent(bundle, client);

    // A report with one bad citation still helps an on-call more than nothing,
    // and the grader records the failure honestly either way.
    expect(report.timeline[0]!.citations[0]!.line).toBe(99999);
    expect(client.steps.filter((s) => s.includes('repair'))).toHaveLength(2);
  });
});

describe('ablations', () => {
  const original = process.env.AGENT_FEATURES;
  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_FEATURES;
    else process.env.AGENT_FEATURES = original;
  });

  it('skips the triage call and uses fixed queries when triage is off', async () => {
    process.env.AGENT_FEATURES = 'search,verify';
    let draftPrompt = '';
    const respond = scripted();
    const client = stubClient((options) => {
      if (options.step.includes('draft')) {
        draftPrompt = options.messages.map((m) => m.content).join('\n');
      }
      return respond(options);
    });

    await solveWithAgent(bundle, client);

    expect(client.steps.some((s) => s.includes('triage'))).toBe(false);
    expect(draftPrompt).toContain('search "error"');
    expect(draftPrompt).toContain('triage disabled');
  });

  it('omits search results when search is off', async () => {
    process.env.AGENT_FEATURES = 'triage,verify';
    let draftPrompt = '';
    const respond = scripted();
    const client = stubClient((options) => {
      if (options.step.includes('draft')) {
        draftPrompt = options.messages.map((m) => m.content).join('\n');
      }
      return respond(options);
    });

    await solveWithAgent(bundle, client);

    expect(draftPrompt).toContain('log search disabled');
    expect(draftPrompt).not.toContain('search "percentOff"');
  });

  it('emits a broken draft unrepaired when the verifier is off', async () => {
    process.env.AGENT_FEATURES = 'triage,search';
    const broken = goodReport();
    broken.evidence[0]!.citations[0]!.quote = 'never appeared anywhere';
    const client = stubClient(scripted({ draft: JSON.stringify(broken) }));

    const report = await solveWithAgent(bundle, client);

    expect(client.steps.some((s) => s.includes('repair'))).toBe(false);
    expect(report.evidence[0]!.citations[0]!.quote).toBe('never appeared anywhere');
  });

  it('rejects an unknown feature name rather than silently ignoring it', async () => {
    process.env.AGENT_FEATURES = 'triage,nonsense';
    const client = stubClient(scripted());
    await expect(solveWithAgent(bundle, client)).rejects.toThrow(/nonsense/);
  });
});

describe('investigation loop', () => {
  const original = process.env.AGENT_FEATURES;
  afterEach(() => {
    if (original === undefined) delete process.env.AGENT_FEATURES;
    else process.env.AGENT_FEATURES = original;
  });

  it('feeds each round the results of the previous one', async () => {
    const prompts: string[] = [];
    let round = 0;
    const client = stubClient((options) => {
      if (options.step.includes('investigate')) {
        prompts.push(options.messages.map((m) => m.content).join('\n'));
        return round++ === 0 ? INVESTIGATE_MORE : INVESTIGATE_DONE;
      }
      return JSON.stringify(goodReport());
    });

    await solveWithAgent(bundle, client);

    // Round two must be able to see what round one turned up, or it is not a
    // loop, just two independent searches.
    expect(prompts[1]).toContain('search "v2026.3.17-a1"');
  });

  it('stops when the workflow says it has enough', async () => {
    const client = stubClient(scripted());
    await solveWithAgent(bundle, client);
    // One round asked, answered "done", so no second round.
    expect(client.steps.filter((s) => s.includes('investigate'))).toHaveLength(1);
  });

  it('does not spend a round re-running a query it already ran', async () => {
    // A repeated query returns text already in the context window and burns a
    // round for nothing.
    const repeat = JSON.stringify({ reasoning: 'again', next_queries: ['error'] });
    const client = stubClient(scripted({ investigate: repeat }));
    await solveWithAgent(bundle, client);
    expect(client.steps.filter((s) => s.includes('investigate'))).toHaveLength(1);
  });

  it('caps the number of rounds', async () => {
    let n = 0;
    const client = stubClient((options) => {
      if (options.step.includes('investigate')) {
        return JSON.stringify({ reasoning: 'more', next_queries: [`q${n++}`] });
      }
      return JSON.stringify(goodReport());
    });
    await solveWithAgent(bundle, client);
    expect(
      client.steps.filter((s) => s.includes('investigate')).length,
    ).toBeLessThanOrEqual(3);
  });

  it('falls back to one fixed round when investigation is off', async () => {
    process.env.AGENT_FEATURES = 'search,verify';
    const client = stubClient(scripted());
    await solveWithAgent(bundle, client);
    expect(client.steps.some((s) => s.includes('investigate'))).toBe(false);
  });
});
