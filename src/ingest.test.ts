/**
 * Tests for reading a real incident directory.
 *
 * The property that matters is citability: whatever comes back must address
 * lines the way the fixtures do, or every citation the workflow produces is
 * unverifiable against it.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadDirectory } from './ingest.ts';

function incidentDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'incident-'));
  for (const [name, contents] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents, 'utf8');
  }
  return root;
}

describe('loadDirectory', () => {
  it('reads nested telemetry and names sources by relative path', () => {
    const root = incidentDir({
      'logs/api.log': 'first\nsecond',
      'metrics/cpu.csv': 'ts,value\n1,2',
    });
    const bundle = loadDirectory(root);
    expect(bundle.files.map((f) => f.source).sort()).toEqual([
      'logs/api.log',
      'metrics/cpu.csv',
    ]);
  });

  it('addresses lines from one, so citations resolve', () => {
    const root = incidentDir({ 'app.log': 'alpha\nbravo\ncharlie' });
    const file = loadDirectory(root).files[0]!;
    // A citation to line 2 must find "bravo": the whole contract in one line.
    expect(file.lines[1]).toBe('bravo');
  });

  it('ignores a trailing newline rather than inventing a blank last line', () => {
    const root = incidentDir({ 'app.log': 'only\n' });
    expect(loadDirectory(root).files[0]!.lines).toEqual(['only']);
  });

  it('skips files that are not citable telemetry', () => {
    const root = incidentDir({ 'notes.md': '# hi', 'logs/api.log': 'x' });
    expect(loadDirectory(root).files.map((f) => f.source)).toEqual(['logs/api.log']);
  });

  it('skips dependency and version-control directories', () => {
    const root = incidentDir({ 'node_modules/pkg/a.log': 'x', 'app.log': 'y' });
    expect(loadDirectory(root).files.map((f) => f.source)).toEqual(['app.log']);
  });

  it('explains itself when the directory holds nothing citable', () => {
    const root = incidentDir({ 'readme.md': 'nothing here' });
    expect(() => loadDirectory(root)).toThrow(/no telemetry found/);
  });

  it('marks truncation visibly instead of silently shortening a file', () => {
    const root = incidentDir({
      'big.log': Array.from({ length: 20_005 }, (_, i) => `l${i}`).join('\n'),
    });
    const file = loadDirectory(root).files[0]!;
    expect(file.lines).toHaveLength(20_001);
    expect(file.lines.at(-1)).toContain('truncated: 5 further lines');
  });

  it('names the incident after the directory', () => {
    const root = incidentDir({ 'a.log': 'x' });
    expect(loadDirectory(root).caseId).toBe(root.split('/').pop());
  });
});
