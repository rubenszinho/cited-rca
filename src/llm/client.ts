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
    body: JSON.stringify({
      model: config.model,
      messages: options.messages,
      max_tokens: options.maxTokens ?? config.maxTokens,
      temperature: options.temperature ?? config.temperature,
      seed: config.seed,
    }),
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
