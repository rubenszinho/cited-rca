/**
 * Tests for cross-incident memory.
 *
 * The property that matters is not that recall helps - the evaluation decides
 * that - but that it stays honest: it must carry what the workflow concluded,
 * including when that was wrong, and it must never see the ground truth.
 */
import { describe, expect, it } from 'vitest';

import { loadBundle } from '../bundle.ts';
import { IncidentMemory, renderRecall, signalsOf } from './memory.ts';

const pool = loadBundle('05-connection-pool-exhaustion');
const deploy = loadBundle('01-bad-deploy-null-deref');

describe('signalsOf', () => {
  it('names the series that moved', () => {
    const signals = signalsOf(pool);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.join(' ')).toMatch(/rose|fell/);
  });

  it('leaves out series that stayed flat', () => {
    // db cpu_pct is the control in case 05: flat on purpose, and remembering
    // it would make every incident look alike.
    expect(signalsOf(pool).join(' ')).not.toContain('cpu_pct');
  });
});

describe('IncidentMemory', () => {
  it('starts empty, so the first incident gets no hint', () => {
    const memory = new IncidentMemory();
    expect(memory.size()).toBe(0);
    expect(memory.recall(pool)).toEqual([]);
  });

  it('recalls a prior that shares signals', () => {
    const memory = new IncidentMemory();
    memory.remember(pool, 'resource_exhaustion_pool');
    const recalled = memory.recall(pool);
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.concluded).toBe('resource_exhaustion_pool');
  });

  it('does not recall a prior with nothing in common', () => {
    const memory = new IncidentMemory();
    memory.remember(deploy, 'bad_deploy_regression');
    const recalled = memory.recall(pool);
    for (const prior of recalled) {
      expect(prior.signals.some((s) => signalsOf(pool).includes(s))).toBe(true);
    }
  });

  it('keeps a wrong conclusion rather than discarding it', () => {
    // A memory that only kept correct answers would be reading the answer key,
    // and the evaluation would be measuring the grader rather than the agent.
    const memory = new IncidentMemory();
    memory.remember(pool, 'memory_leak'); // wrong on purpose
    expect(memory.recall(pool)[0]!.concluded).toBe('memory_leak');
  });

  it('surfaces at most two priors', () => {
    const memory = new IncidentMemory();
    for (let i = 0; i < 5; i++) memory.remember(pool, 'resource_exhaustion_pool');
    expect(memory.recall(pool).length).toBeLessThanOrEqual(2);
  });
});

describe('renderRecall', () => {
  it('renders nothing when there is nothing to recall', () => {
    expect(renderRecall([])).toBe('');
  });

  it('presents priors as hedged, not as fact', () => {
    const memory = new IncidentMemory();
    memory.remember(pool, 'resource_exhaustion_pool');
    const text = renderRecall(memory.recall(pool));
    expect(text).toContain('not established facts');
    expect(text).toContain('points elsewhere');
  });

  it('cannot see the ground truth', async () => {
    const fs = await import('node:fs');
    const source = fs
      .readFileSync(new URL('./memory.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toContain('loadTruth');
    expect(source).not.toContain('truth');
  });
});
