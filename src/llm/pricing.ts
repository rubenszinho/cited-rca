/**
 * What a run cost, or nothing at all.
 *
 * The rates used to live only in `.env` as two loose numbers. `.env.overrides`
 * then set `LLM_MODEL` to switch provider — and could not set the price,
 * because nothing tied the two together. Every recorded run therefore priced
 * gpt-4.1-mini at Claude Sonnet 4.5's rates and published a `cost_usd` roughly
 * eight times the real figure, in a column `docs/RESULTS.md` renders and the
 * README points readers at.
 *
 * Two changes stop that recurring. The rate is looked up from the model id, so
 * changing the model changes the price by construction. And an unpriced model
 * yields `null` rather than a plausible number: the table then prints "-", which
 * is honest, where a silent 0 or a stale rate is not.
 *
 *   priceOf('gpt-4.1-mini')  // => { in: 0.4, out: 1.6 }
 *   priceOf('some-local-7b') // => undefined  -> cost_usd: null
 */

/** USD per million tokens, as published by each provider. */
const RATES: Record<string, { in: number; out: number }> = {
  'gpt-4.1-mini': { in: 0.4, out: 1.6 },
  'gpt-4.1': { in: 2, out: 8 },
  'gpt-4.1-nano': { in: 0.1, out: 0.4 },
  'anthropic/claude-sonnet-4.5': { in: 3, out: 15 },
  'anthropic/claude-haiku-4.5': { in: 1, out: 5 },
};

/**
 * The rate for a model id, ignoring any provider prefix.
 *
 * OpenRouter names the same model `openai/gpt-4.1-mini` that OpenAI names
 * `gpt-4.1-mini`, and the run is the same run either way.
 */
export function priceOf(model: string): { in: number; out: number } | undefined {
  return RATES[model] ?? RATES[model.split('/').slice(-1)[0] ?? ''];
}

/** An explicit rate pair from the environment, when both halves are set. */
function rateFromEnv(): { in: number; out: number } | undefined {
  const into = process.env.LLM_PRICE_IN_PER_MTOK;
  const out = process.env.LLM_PRICE_OUT_PER_MTOK;
  if (into === undefined || out === undefined) return undefined;
  return { in: Number(into), out: Number(out) };
}

/**
 * Cost of a run in USD, or `null` when the model has no known rate.
 *
 * An environment override wins, so an unlisted or self-hosted model can still
 * be priced without editing the table.
 */
export function costUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const rate = rateFromEnv() ?? priceOf(model);
  if (rate === undefined) return null;
  return Number(
    ((promptTokens * rate.in + completionTokens * rate.out) / 1e6).toFixed(4),
  );
}
