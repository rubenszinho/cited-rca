/**
 * Tests for statement grounding.
 *
 * A reviewer built a report of pure nonsense — "Badgers operate the load
 * balancer" — citing exactly the required lines with genuine twelve-character
 * quotes, and scored 12/12 sound. The grader had never looked at the statement
 * text. These tests pin the floor that closes, and the false positives it must
 * not create.
 */
import { describe, expect, it } from 'vitest';

import { loadBundle } from './bundle.ts';
import { isGrounded, terms } from './grounding.ts';
import type { Finding } from './schema.ts';

const bundle = loadBundle('01-bad-deploy-null-deref');

function cite(source: string, needle: string) {
  const file = bundle.files.find((f) => f.source === source)!;
  const index = file.lines.findIndex((l) => l.includes(needle));
  return { source, line: index + 1, quote: needle };
}

const finding = (statement: string, citations: Finding['citations']): Finding => ({
  statement,
  citations,
});

describe('terms', () => {
  it('drops words too common to indicate what a statement is about', () => {
    expect(terms('that this error started during the incident').size).toBe(0);
  });

  it('keeps identifiers', () => {
    expect(terms('release v2026.3.17-a1 shipped')).toContain('v2026.3.17-a1');
  });
});

describe('isGrounded', () => {
  it('accepts a statement describing the line it cites', () => {
    const f = finding('Guest checkouts raised a TypeError on percentOff.', [
      cite('logs/app.jsonl', "reading 'percentOff'"),
    ]);
    expect(isGrounded(bundle, f)).toBe(true);
  });

  it('rejects nonsense that cites a real line with a real quote', () => {
    // The exact attack: right line, genuine quote, statement about nothing.
    const f = finding('Badgers operate the load balancer.', [
      cite('logs/app.jsonl', "reading 'percentOff'"),
    ]);
    expect(isGrounded(bundle, f)).toBe(false);
  });

  it('accepts a statement about a metric row via the header naming its columns', () => {
    // A metric row is all numbers; nothing in it is a word. The header says
    // what those numbers are, so it is part of what the line is about.
    const f = finding('Error rate stepped up sharply.', [
      { source: 'metrics/http.csv', line: 30, quote: '2026-03-17T09:2' },
    ]);
    expect(isGrounded(bundle, f)).toBe(true);
  });

  it('rejects a statement that cites nothing resolvable', () => {
    const f = finding('The pool drained completely.', [
      { source: 'logs/app.jsonl', line: 99999, quote: 'not on any line' },
    ]);
    expect(isGrounded(bundle, f)).toBe(false);
  });

  it('accepts when any one of several citations is related', () => {
    const f = finding('Guest checkouts raised a TypeError on percentOff.', [
      cite('changes.jsonl', 'v2026.3.16-f3'),
      cite('logs/app.jsonl', "reading 'percentOff'"),
    ]);
    expect(isGrounded(bundle, f)).toBe(true);
  });

  it('rejects an empty statement', () => {
    expect(
      isGrounded(bundle, finding('the that this', [cite('changes.jsonl', 'v2026')])),
    ).toBe(false);
  });
});
