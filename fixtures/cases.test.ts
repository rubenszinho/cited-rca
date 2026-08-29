/**
 * Integrity of the case set itself.
 *
 * A truth.json that references a line no bundle file contains produces a case
 * nothing can ever pass, and the failure would look like a weak workflow rather
 * than a broken fixture. These tests make that impossible to ship.
 */
import { describe, expect, it } from 'vitest';

import { listCases, loadBundle, loadTruth } from '../src/bundle.ts';
import { ROOT_CAUSES } from './model.ts';

const cases = listCases();

/** Every line of the bundle file at `source`, or undefined if there is none. */
function linesOf(caseId: string, source: string): string[] | undefined {
  return loadBundle(caseId).files.find((file) => file.source === source)?.lines;
}

describe('case set', () => {
  it('has twelve cases', () => {
    expect(cases).toHaveLength(12);
  });

  it('covers every root cause exactly once', () => {
    const causes = cases.map((id) => loadTruth(id).root_cause).sort();
    expect(causes).toEqual([...ROOT_CAUSES].sort());
  });

  it('gives every case at least one red herring', () => {
    // A case with nothing tempting in it measures nothing about judgement.
    for (const id of cases) {
      expect(loadTruth(id).red_herrings.length, id).toBeGreaterThan(0);
    }
  });
});

describe.each(cases)('%s', (caseId) => {
  const truth = loadTruth(caseId);

  it('every required evidence reference resolves to a real line', () => {
    for (const ref of truth.required_evidence) {
      const lines = linesOf(caseId, ref.source);
      expect(lines, `${caseId}: no bundle file ${ref.source}`).toBeDefined();
      const hit = lines?.some((line) => line.includes(ref.match));
      expect(hit, `${caseId}: "${ref.match}" absent from ${ref.source}`).toBe(true);
    }
  });

  it('every red herring reference resolves to a real line', () => {
    for (const herring of truth.red_herrings) {
      const lines = linesOf(caseId, herring.source);
      expect(lines, `${caseId}: no bundle file ${herring.source}`).toBeDefined();
      const hit = lines?.some((line) => line.includes(herring.match));
      expect(hit, `${caseId}: "${herring.match}" absent from ${herring.source}`).toBe(
        true,
      );
    }
  });

  it('requires at least three pieces of evidence', () => {
    // One citation is a guess that landed; three across different sources is an
    // argument. The threshold is what makes evidence recall meaningful.
    expect(truth.required_evidence.length).toBeGreaterThanOrEqual(3);
  });

  it('draws its evidence from more than one source', () => {
    const sources = new Set(truth.required_evidence.map((ref) => ref.source));
    expect(sources.size, `${caseId} cites only ${[...sources]}`).toBeGreaterThan(1);
  });

  it('has no metric series that never moves', () => {
    // A multiplicative fault model cannot move a counter that starts at zero,
    // and the failure is silent: the series is emitted, ranked as "did not
    // move", and actively argues against the cause it was meant to evidence.
    // Three series shipped that way before this test existed.
    const bundle = loadBundle(caseId);
    for (const file of bundle.files.filter((f) => f.source.startsWith('metrics/'))) {
      const [header, ...rows] = file.lines;
      const columns = (header ?? '').split(',');
      for (let col = 1; col < columns.length; col++) {
        const values = new Set(rows.map((row) => row.split(',')[col]));
        expect(
          values.size,
          `${caseId} ${file.source} ${columns[col]} is constant`,
        ).toBeGreaterThan(1);
      }
    }
  });

  it('places onset before detection', () => {
    expect(Date.parse(truth.onset_ts)).toBeLessThan(Date.parse(truth.detected_ts));
  });
});
