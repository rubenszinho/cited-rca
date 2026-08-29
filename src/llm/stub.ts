/**
 * A scripted LlmClient for tests.
 *
 * Lets the whole workflow run - triage, search, draft, verify, repair - with no
 * key, no network and no cassette, so the orchestration is testable
 * independently of whether any model behaves well on a given day.
 */
import type { Completion, CompleteOptions, LlmClient, Usage } from './types.ts';

/** Chooses a canned response from the step label and the messages so far. */
export type Script = (options: CompleteOptions, callIndex: number) => string;

export type StubClient = LlmClient & {
  /** Step labels in call order, so tests can assert the workflow's shape. */
  steps: string[];
};

export function stubClient(script: Script): StubClient {
  const steps: string[] = [];
  const totals: Usage & { calls: number; replayed: number } = {
    prompt_tokens: 0,
    completion_tokens: 0,
    calls: 0,
    replayed: 0,
  };
  return {
    steps,
    async complete(options: CompleteOptions): Promise<Completion> {
      const content = script(options, steps.length);
      steps.push(options.step);
      totals.calls += 1;
      totals.prompt_tokens += 10;
      totals.completion_tokens += 5;
      return {
        content,
        usage: { prompt_tokens: 10, completion_tokens: 5 },
        replayed: false,
      };
    },
    totals: () => ({ ...totals }),
  };
}
