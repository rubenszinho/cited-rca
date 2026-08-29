/**
 * Recorded model responses.
 *
 * The reproducibility claim in the README is that a judge can rerun the
 * evaluation and get the committed numbers back. Live model calls cannot
 * promise that: they cost money, need an account, and drift as providers
 * retrain. So every call made during the recorded run is written to a cassette
 * keyed by its exact request, and the default mode replays those.
 *
 * A cassette miss is a hard error rather than a silent live call. Falling back
 * would mean a judge's "reproduction" quietly diverged from what was measured.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Completion, CompleteOptions } from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const CASSETTE_DIR = join(HERE, '..', '..', 'fixtures', 'cassettes');

export type CassetteMode = 'replay' | 'record' | 'live';

/**
 * Identity of a request. Model, seed and sampling parameters are all part of
 * the key, so changing any of them invalidates the recording instead of
 * replaying a response the new configuration would never have produced.
 *
 * The seed is in the key because the evaluation runs each variant several
 * times: without it every repeat would hit the same recording and the reported
 * spread would be zero by construction rather than by measurement.
 */
export function cassetteKey(
  model: string,
  seed: number,
  options: CompleteOptions,
): string {
  const canonical = JSON.stringify({
    model,
    seed,
    temperature: options.temperature ?? 0,
    maxTokens: options.maxTokens ?? 0,
    messages: options.messages,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}

function pathFor(key: string): string {
  return join(CASSETTE_DIR, `${key}.json`);
}

export function readCassette(key: string): Completion | undefined {
  const path = pathFor(key);
  if (!existsSync(path)) return undefined;
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  return { content: stored.content, usage: stored.usage, replayed: true };
}

export function writeCassette(
  key: string,
  model: string,
  options: CompleteOptions,
  completion: Completion,
): void {
  mkdirSync(CASSETTE_DIR, { recursive: true });
  // `step` and the prompt are stored alongside the response so a reviewer can
  // read a cassette and see what was asked, not just what came back.
  const record = {
    key,
    model,
    step: options.step,
    messages: options.messages,
    content: completion.content,
    usage: completion.usage,
  };
  writeFileSync(pathFor(key), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

export function missError(key: string, step: string): Error {
  return new Error(
    `cassette miss for step "${step}" (key ${key}).\n` +
      'The committed cassettes replay the recorded evaluation exactly, so a miss ' +
      'means the prompt changed since they were recorded.\n' +
      'Re-record with: LLM_MODE=record task project:agent  (needs LLM_API_KEY)',
  );
}
