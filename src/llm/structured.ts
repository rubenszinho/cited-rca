/**
 * One structured call: ask, extract, validate, and repair once.
 *
 * Both the baseline and the workflow go through this. That is deliberate — the
 * experiment is about reasoning architecture, so giving only one side JSON
 * repair would move the measurement onto plumbing and make the comparison
 * unfair in the way the brief warns about.
 *
 * The repair turn feeds the validation error back rather than reasking blindly,
 * because "field X is missing" is information the model can act on.
 */
import type { z } from 'zod';

import { parseAs } from './json.ts';
import type { ChatMessage, LlmClient } from './types.ts';

export type StructuredRequest<T> = {
  client: LlmClient;
  step: string;
  schema: z.ZodType<T>;
  messages: ChatMessage[];
  maxTokens?: number;
};

export type StructuredResult<T> = {
  value: T;
  /** True when the first response failed validation and a repair turn was spent. */
  repaired: boolean;
};

export async function completeJson<T>(
  request: StructuredRequest<T>,
): Promise<StructuredResult<T>> {
  const { client, step, schema, messages, maxTokens } = request;
  const first = await client.complete({ step, messages, maxTokens });
  try {
    return { value: parseAs(schema, first.content), repaired: false };
  } catch (error) {
    const repairMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: first.content },
      {
        role: 'user',
        content:
          `That response did not satisfy the required schema: ${String(error)}\n` +
          'Reply with the corrected JSON object only. No prose, no code fences.',
      },
    ];
    const second = await client.complete({
      step: `${step}:repair`,
      messages: repairMessages,
      maxTokens,
    });
    return { value: parseAs(schema, second.content), repaired: true };
  }
}
