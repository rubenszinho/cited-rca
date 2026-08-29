/**
 * Getting a typed object out of a model response.
 *
 * Models wrap JSON in prose or fences often enough that a bare JSON.parse
 * fails on responses that are otherwise fine. Extracting the outermost object
 * and validating it against the schema separates "did not answer in JSON" from
 * "answered in JSON that does not fit the contract" — the two need different
 * recovery, and the distinction is worth reporting rather than collapsing.
 */
import type { z } from 'zod';

export class JsonExtractionError extends Error {}
export class SchemaError extends Error {}

/** The outermost {...} in `text`, brace-matched so nested objects survive. */
export function extractJsonObject(text: string): string {
  const start = text.indexOf('{');
  if (start < 0) throw new JsonExtractionError('response contains no JSON object');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new JsonExtractionError('response has an unterminated JSON object');
}

export function parseAs<T>(schema: z.ZodType<T>, text: string): T {
  const json = extractJsonObject(text);
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new JsonExtractionError(`extracted text is not valid JSON: ${String(cause)}`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new SchemaError(issues);
  }
  return result.data;
}
