/**
 * Tests for JSON extraction.
 *
 * Models wrap JSON in fences and prose, and the incident reports here contain
 * braces and escaped quotes inside their own strings. Brace counting that
 * ignores string context truncates exactly those responses, and the failure
 * would look like a bad answer rather than a bad parser.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  extractJsonObject,
  JsonExtractionError,
  parseAs,
  SchemaError,
} from './json.ts';

describe('extractJsonObject', () => {
  it('takes a bare object', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('takes an object out of a fenced block with prose around it', () => {
    const text = 'Here you go:\n```json\n{"a":1}\n```\nHope that helps.';
    expect(extractJsonObject(text)).toBe('{"a":1}');
  });

  it('keeps nested objects intact', () => {
    expect(extractJsonObject('x {"a":{"b":{"c":2}}} y')).toBe('{"a":{"b":{"c":2}}}');
  });

  it('ignores braces inside strings', () => {
    const text = '{"msg":"a } brace in prose","n":1}';
    expect(extractJsonObject(text)).toBe(text);
  });

  it('ignores escaped quotes inside strings', () => {
    // A log line quoted verbatim in a citation looks exactly like this.
    const text = String.raw`{"quote":"reading \"percentOff\" }","n":1}`;
    expect(extractJsonObject(text)).toBe(text);
  });

  it('rejects text with no object', () => {
    expect(() => extractJsonObject('no json here')).toThrow(JsonExtractionError);
  });

  it('rejects an unterminated object', () => {
    expect(() => extractJsonObject('{"a":1')).toThrow(JsonExtractionError);
  });
});

describe('parseAs', () => {
  const schema = z.object({ a: z.number() });

  it('returns the parsed value', () => {
    expect(parseAs(schema, 'sure: {"a":1}')).toEqual({ a: 1 });
  });

  it('distinguishes a schema failure from a parse failure', () => {
    // The two need different recovery, so they must not collapse into one error.
    expect(() => parseAs(schema, '{"a":"one"}')).toThrow(SchemaError);
    expect(() => parseAs(schema, 'nothing')).toThrow(JsonExtractionError);
  });

  it('names the offending field so a repair turn can act on it', () => {
    expect(() => parseAs(schema, '{"b":1}')).toThrow(/a:/);
  });
});
