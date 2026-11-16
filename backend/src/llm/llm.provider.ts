import type { LlmOutput } from './llm-output.schema.js';

export interface LlmAssessmentInput {
  claimText: string;
  evidenceText: string;
}

export interface LlmAssessmentResult {
  output: LlmOutput;
  meta: {
    model: string;
    promptVersion: string;
    latencyMs: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * The seam between our code and any language-model vendor. Nest injects the real or the fake one,
 * so the rest of the app (and every test) never touches the network.
 */
export abstract class LlmProvider {
  abstract assess(input: LlmAssessmentInput): Promise<LlmAssessmentResult>;
}

/** The provider could not be reached, was rate-limited, timed out, or rejected our request. */
export class LlmUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LlmUnavailableError';
  }
}

export type LlmOutputProblem = 'refusal' | 'truncated' | 'content_filter' | 'invalid' | 'empty';

/** The provider answered, but the answer is unusable (refused, cut off, or not the shape we asked for). */
export class LlmOutputError extends Error {
  constructor(
    readonly problem: LlmOutputProblem,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmOutputError';
  }
}
