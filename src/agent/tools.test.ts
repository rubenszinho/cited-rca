/**
 * Tests for the deterministic tools.
 *
 * Both defects pinned here were found by an outside reviewer, not by this
 * suite, and both were invisible on the fixtures: the synthetic bundles are
 * always clean and always fixture-shaped, so a tool coupled to that shape looks
 * correct right up until it meets a real export.
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDirectory } from '../ingest.ts';
import { metricMoves, searchLog } from './tools.ts';

function bundleFrom(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'tools-'));
  for (const [name, body] of Object.entries(files))
    writeFileSync(join(root, name), body);
  return loadDirectory(root);
}

describe('metricMoves', () => {
  it('finds a series file that is not under metrics/', () => {
    // Keying on the directory name returned nothing for an export sitting at
    // the root of an incident folder - losing every metric on exactly the input
    // ingestion exists to handle.
    const moves = metricMoves(bundleFrom({ 'cpu.csv': 'ts,pct\n1,10\n2,90\n' }));
    expect(moves.map((m) => m.series)).toEqual(['pct']);
  });

  it('ignores non-numeric cells rather than turning them into NaN', () => {
    const moves = metricMoves(bundleFrom({ 'm.csv': 'ts,pct\n1,10\n2,NaN\n3,90\n' }));
    expect(moves[0]!.min).toBe(10);
    expect(moves[0]!.max).toBe(90);
    expect(Number.isFinite(moves[0]!.swing_pct)).toBe(true);
  });

  it('treats an empty cell as missing, not as zero', () => {
    const moves = metricMoves(bundleFrom({ 'm.csv': 'ts,pct\n1,40\n2,\n3,60\n' }));
    expect(moves[0]!.min).toBe(40);
  });

  it('does not report a text column as a metric', () => {
    const moves = bundleFrom({ 'm.csv': 'ts,note\n1,ok\n2,\n3,bad\n' });
    expect(metricMoves(moves)).toEqual([]);
  });

  it('ignores a file that is not comma-separated at all', () => {
    expect(metricMoves(bundleFrom({ 'a.log': 'plain text\nmore text\n' }))).toEqual([]);
  });
});

describe('searchLog', () => {
  it('searches every bulk file, not one hardcoded name', () => {
    const big = (tag: string) =>
      Array.from({ length: 500 }, (_, i) => `${tag} line ${i} needle`).join('\n');
    const bundle = bundleFrom({ 'a.log': big('a'), 'b.log': big('b') });
    // Only addressed lines count; the "# N lines match" markers are notes.
    const addressed = searchLog(bundle, 'needle', 8).filter((l) =>
      /^[^#].*:\d+\| /.test(l),
    );
    const sources = new Set(addressed.map((l) => l.split(':')[0]));
    expect(sources).toEqual(new Set(['a.log', 'b.log']));
  });

  it('returns addressed lines whose numbers are real', () => {
    const bundle = bundleFrom({ 'a.log': 'alpha\nbravo needle\ncharlie\n' });
    const [hit] = searchLog(bundle, 'needle', 5);
    expect(hit).toBe('a.log:2| bravo needle');
  });
});
