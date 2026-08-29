/**
 * Tests for provider compatibility.
 *
 * The client is provider-agnostic in the sense that it speaks one wire format,
 * but "OpenAI-compatible" is not one shape. Reasoning models reject the field
 * every other model requires, and the failure is a 400 on every case, which
 * reads as a broken workflow rather than a parameter name.
 */
import { describe, expect, it } from 'vitest';

import { needsCompletionTokens, requestBody, type ClientConfig } from './client.ts';

const config = (model: string): ClientConfig => ({
  baseUrl: 'https://example.test/v1',
  apiKey: 'unused-in-these-tests',
  model,
  maxTokens: 8000,
  temperature: 0,
  mode: 'replay',
  seed: 3,
});

const options = { step: 'draft', messages: [{ role: 'user' as const, content: 'hi' }] };

describe('needsCompletionTokens', () => {
  it.each(['gpt-5', 'gpt-5-mini', 'openai/gpt-5', 'o1-preview', 'o3-mini'])(
    'is true for %s',
    (model) => expect(needsCompletionTokens(model)).toBe(true),
  );

  it.each([
    'gpt-4.1',
    'gpt-4o-mini',
    'openai/gpt-4.1-mini',
    'anthropic/claude-sonnet-4.5',
  ])('is false for %s', (model) => expect(needsCompletionTokens(model)).toBe(false));

  it('does not match a model that merely starts with the same letters', () => {
    // "o1" must not swallow "openrouter/..." or "openai/gpt-4.1".
    expect(needsCompletionTokens('openai/gpt-4.1')).toBe(false);
  });
});

describe('requestBody', () => {
  it('sends max_tokens and temperature to a standard model', () => {
    const body = requestBody(config('gpt-4.1'), options) as Record<string, unknown>;
    expect(body.max_tokens).toBe(8000);
    expect(body.temperature).toBe(0);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it('sends max_completion_tokens to a reasoning model', () => {
    const body = requestBody(config('gpt-5-mini'), options) as Record<string, unknown>;
    expect(body.max_completion_tokens).toBe(8000);
    expect(body.max_tokens).toBeUndefined();
  });

  it('omits temperature for a reasoning model rather than sending the default', () => {
    // Sending it explicitly is a 400 even when the value is the one allowed.
    const body = requestBody(config('o3-mini'), options) as Record<string, unknown>;
    expect('temperature' in body).toBe(false);
  });

  it('always carries the seed, so repeats are distinct runs', () => {
    for (const model of ['gpt-4.1', 'gpt-5-mini']) {
      expect(
        (requestBody(config(model), options) as Record<string, unknown>).seed,
      ).toBe(3);
    }
  });
});
