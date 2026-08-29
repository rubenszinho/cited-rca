/**
 * The model boundary.
 *
 * Everything above this file talks to `LlmClient` and never to a provider. That
 * is what lets the same workflow run live against OpenRouter, replay from a
 * committed cassette with no key at all, or run against a stub in tests.
 */

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
};

export type Completion = {
  content: string;
  usage: Usage;
  /** True when the response came from a cassette rather than the provider. */
  replayed: boolean;
};

export type CompleteOptions = {
  /** Label for the cassette and the trajectory, e.g. "hypothesise". */
  step: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
};

export interface LlmClient {
  complete(options: CompleteOptions): Promise<Completion>;
  /** Tokens consumed so far, across every call on this client. */
  totals(): Usage & { calls: number; replayed: number };
}
