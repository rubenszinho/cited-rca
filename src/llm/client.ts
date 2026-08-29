/**
 * OpenAI-compatible client.
 *
 * Provider-agnostic by construction: base URL, key and model all come from the
 * environment, so pointing this at OpenRouter, OpenAI, or a self-hosted proxy
 * is configuration rather than a code change. A judge reproducing the run does
 * not have to hold an account with any particular vendor.
 */
import {
  cassetteKey,
  missError,
  readCassette,
  writeCassette,
  type CassetteMode,
} from './cassette.ts';
import type { Completion, CompleteOptions, LlmClient, Usage } from './types.ts';

export type ClientConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  mode: CassetteMode;
  /**
   * Repeat index for this run, from the harness.
   *
   * Passed to the provider (ignored by those that do not support it) and folded
   * into the cassette key, so repeats are genuinely separate runs. Even at
   * temperature 0 providers are not bit-deterministic, so the spread across
   * repeats is a real number worth reporting rather than an assumed zero.
   */
  seed: number;
};

function envMode(): CassetteMode {
  const mode = process.env.LLM_MODE;
  if (mode === 'record' || mode === 'live' || mode === 'replay') return mode;
  // Replay by default so a clone with no key still reproduces the evaluation.
  return 'replay';
}

export function configFromEnv(): ClientConfig {
  return {
    baseUrl: process.env.LLM_BASE_URL ?? 'https://openrouter.ai/api/v1',
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? 'anthropic/claude-sonnet-4.5',
    maxTokens: Number(process.env.LLM_MAX_TOKENS ?? 8000),
    temperature: Number(process.env.LLM_TEMPERATURE ?? 0),
    mode: envMode(),
    seed: Number(process.env.SEED ?? 0),
  };
}

/**
 * Models that reject the older request shape.
 *
 * OpenAI's reasoning models refuse `max_tokens` (they want
 * `max_completion_tokens`) and refuse any temperature other than 1. Sending the
 * old field to one of them fails the whole run with a 400, which reads as a
 * broken workflow rather than a parameter name.
 *
 * Matched on the bare model id so it works whether the provider prefixes it
 * (`openai/gpt-5-mini` through a gateway) or not (`gpt-5-mini` direct).
 */
const REASONING_MODEL = /^(?:gpt-5|o[1-9])(?:[-.]|$)/;

export function needsCompletionTokens(model: string): boolean {
  return REASONING_MODEL.test(model.split('/').pop() ?? model);
}

/** Request payload, adapted to what the target model will accept. */
export function requestBody(config: ClientConfig, options: CompleteOptions): object {
  const base = {
    model: config.model,
    messages: options.messages,
    seed: config.seed,
  };
  const limit = options.maxTokens ?? config.maxTokens;
  if (needsCompletionTokens(config.model)) {
    // Temperature is deliberately omitted rather than set: these models accept
    // only the default, and sending it explicitly is a 400.
    return { ...base, max_completion_tokens: limit };
  }
  return {
    ...base,
    max_tokens: limit,
    temperature: options.temperature ?? config.temperature,
  };
}

type ApiResponse = {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

async function callProvider(
  config: ClientConfig,
  options: CompleteOptions,
): Promise<Completion> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(requestBody(config, options)),
  });

  const body = (await response.json()) as ApiResponse;
  if (!response.ok || body.error) {
    throw new Error(
      `${config.model} returned ${response.status}: ${body.error?.message ?? ''}`,
    );
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error(`${config.model} returned no message content`);
  }
  return {
    content,
    usage: {
      prompt_tokens: body.usage?.prompt_tokens ?? 0,
      completion_tokens: body.usage?.completion_tokens ?? 0,
    },
    replayed: false,
  };
}

export function createClient(config: ClientConfig = configFromEnv()): LlmClient {
  const totals: Usage & { calls: number; replayed: number } = {
    prompt_tokens: 0,
    completion_tokens: 0,
    calls: 0,
    replayed: 0,
  };

  async function fetchCompletion(options: CompleteOptions): Promise<Completion> {
    const key = cassetteKey(config.model, config.seed, options);
    if (config.mode !== 'live') {
      const cached = readCassette(key);
      if (cached) return cached;
      if (config.mode === 'replay') throw missError(key, options.step);
    }
    if (!config.apiKey) {
      throw new Error(
        `LLM_API_KEY is unset and step "${options.step}" needs a live call. ` +
          'Add it to .env.overrides, or run in replay mode against the committed cassettes.',
      );
    }
    const completion = await callProvider(config, options);
    if (config.mode === 'record') writeCassette(key, config.model, options, completion);
    return completion;
  }

  return {
    async complete(options) {
      const completion = await fetchCompletion(options);
      totals.calls += 1;
      totals.prompt_tokens += completion.usage.prompt_tokens;
      totals.completion_tokens += completion.usage.completion_tokens;
      if (completion.replayed) totals.replayed += 1;
      return completion;
    },
    totals: () => ({ ...totals }),
  };
}
