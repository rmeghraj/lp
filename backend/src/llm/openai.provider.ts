import OpenAI from 'openai';
import { ContentFilterFinishReasonError, LengthFinishReasonError } from 'openai/core/error';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ZodError } from 'zod';
import { LlmOutputSchema } from './llm-output.schema.js';
import {
  LlmOutputError,
  LlmProvider,
  LlmUnavailableError,
  type LlmAssessmentInput,
  type LlmAssessmentResult,
} from './llm.provider.js';
import { buildUserMessage, PROMPT_VERSION, SYSTEM_PROMPT } from './prompt.js';

/** A real answer is a few hundred tokens. This only stops a runaway reply from costing money. */
const MAX_COMPLETION_TOKENS = 4000;

export interface OpenAiProviderOptions {
  model: string;
  /** Left out of the request when undefined, because some models (for example reasoning models) reject it. */
  temperature?: number;
}

/**
 * Asks OpenAI to read the study and answer in a strict JSON schema (Structured Outputs).
 * Timeouts and retries (429, 5xx, dropped connections) are handled by the SDK client we are given.
 * This class turns every way the call can go wrong into one of two errors the rest of the app understands:
 * the provider was unavailable, or it answered with something unusable.
 */
export class OpenAiProvider extends LlmProvider {
  constructor(
    private readonly client: OpenAI,
    private readonly options: OpenAiProviderOptions,
    private readonly newToken: () => string = () => crypto.randomUUID(),
  ) {
    super();
  }

  async assess(input: LlmAssessmentInput): Promise<LlmAssessmentResult> {
    const startedAt = performance.now();
    try {
      const completion = await this.client.chat.completions.parse({
        model: this.options.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(input, this.newToken()) },
        ],
        response_format: zodResponseFormat(LlmOutputSchema, 'claim_assessment'),
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        ...(this.options.temperature === undefined ? {} : { temperature: this.options.temperature }),
      });

      const message = completion.choices[0]?.message;
      if (message?.refusal) throw new LlmOutputError('refusal', 'The model declined to assess this study');
      if (!message?.parsed) throw new LlmOutputError('empty', 'The model returned no assessment');

      return {
        output: message.parsed,
        meta: {
          model: completion.model, // the exact snapshot that answered, which is what an audit needs
          promptVersion: PROMPT_VERSION,
          latencyMs: Math.round(performance.now() - startedAt),
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
        },
      };
    } catch (error) {
      throw classify(error);
    }
  }
}

/**
 * Vendor detail goes in `cause` (for the logs) and never in the message (which reaches API clients).
 * Anything unrecognised is a bug in our own code and is passed through untouched.
 */
function classify(error: unknown): unknown {
  if (error instanceof LlmOutputError || error instanceof LlmUnavailableError) return error;
  if (error instanceof OpenAI.APIError) {
    return new LlmUnavailableError('The language-model service is unavailable', { cause: error });
  }
  if (error instanceof LengthFinishReasonError) {
    return new LlmOutputError('truncated', "The model's answer was cut off", { cause: error });
  }
  if (error instanceof ContentFilterFinishReasonError) {
    return new LlmOutputError('content_filter', "The model's answer was stopped by a content filter", { cause: error });
  }
  if (error instanceof SyntaxError || error instanceof ZodError) {
    return new LlmOutputError('invalid', "The model's answer was not in the expected format", { cause: error });
  }
  return error;
}
