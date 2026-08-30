/**
 * Tests for run pricing.
 *
 * The regression these exist for: `.env` pinned Claude Sonnet 4.5's rates while
 * `.env.overrides` pointed the model at gpt-4.1-mini. Overriding the model could
 * not override the price, so every committed run published a cost about eight
 * times the real one — in a column docs/RESULTS.md renders.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { costUsd, priceOf } from './pricing.ts';

const ENV_KEYS = ['LLM_PRICE_IN_PER_MTOK', 'LLM_PRICE_OUT_PER_MTOK'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('priceOf', () => {
  it('prices a known model', () => {
    expect(priceOf('gpt-4.1-mini')).toEqual({ in: 0.4, out: 1.6 });
  });

  it('ignores a provider prefix', () => {
    // OpenRouter and OpenAI name the same model differently.
    expect(priceOf('openai/gpt-4.1-mini')).toEqual(priceOf('gpt-4.1-mini'));
  });

  it('returns nothing for a model it cannot price', () => {
    expect(priceOf('some-local-7b')).toBeUndefined();
  });
});

describe('costUsd', () => {
  it('prices a run from the model, not from the environment', () => {
    // The bug, pinned: the model is the only input that decides the rate.
    expect(costUsd('gpt-4.1-mini', 1_000_000, 1_000_000)).toBe(2);
  });

  it('does not price a run it has no rate for', () => {
    // A wrong number is worse than no number in a published table.
    expect(costUsd('some-local-7b', 1_000_000, 1_000_000)).toBeNull();
  });

  it('lets an explicit rate pair price an unlisted model', () => {
    process.env.LLM_PRICE_IN_PER_MTOK = '3';
    process.env.LLM_PRICE_OUT_PER_MTOK = '15';
    expect(costUsd('some-local-7b', 1_000_000, 1_000_000)).toBe(18);
  });

  it('ignores a half-set override rather than pricing at zero', () => {
    process.env.LLM_PRICE_IN_PER_MTOK = '3';
    expect(costUsd('gpt-4.1-mini', 1_000_000, 1_000_000)).toBe(2);
  });
});
