// Test utility: not part of the production build (excluded in tsconfig.build.json).
import type { LlmOutput } from '../../../llm/llm-output.schema.js';
import type { Facts } from '../types.js';

export const CLAIM_TEXT = 'Reduces wrinkles by 20% in 4 weeks';
export const EVIDENCE_TEXT =
  'Randomised vehicle-controlled study of 45 women. At week 4, wrinkle depth was reduced by 23% from baseline (p = 0.003).';

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A complete, valid model output for a strong study. Tests override only the parts they care about. */
export function makeOutput(patch: DeepPartial<LlmOutput> = {}): LlmOutput {
  return merge(strongStudyOutput(), patch);
}

/** Verified facts for the same strong study. Tests override only the parts they care about. */
export function makeFacts(patch: DeepPartial<Facts> = {}): Facts {
  return merge(strongStudyFacts(), patch);
}

function strongStudyOutput(): LlmOutput {
  return {
    claim: {
      metric: 'wrinkle depth',
      direction: 'decrease',
      magnitudePercent: 20,
      timeframe: { value: 4, unit: 'weeks' },
    },
    study: {
      design: 'randomized_controlled',
      endpointMatchesClaim: true,
      sampleSize: { value: 45, quote: 'study of 45 women' },
      effect: {
        direction: 'decrease',
        percent: 23,
        timepoint: { value: 4, unit: 'weeks' },
        quote: 'At week 4, wrinkle depth was reduced by 23% from baseline',
      },
      pValue: { value: 0.003, quote: 'p = 0.003' },
    },
    verdict: { justified: true, confidence: 0.9, reasoning: 'The study supports the claim.' },
  };
}

function strongStudyFacts(): Facts {
  return {
    claim: { metric: 'wrinkle depth', direction: 'decrease', magnitudePercent: 20, timeframeWeeks: 4 },
    study: {
      design: 'randomized_controlled',
      endpointMatchesClaim: true,
      sampleSize: 45,
      effect: { direction: 'decrease', percent: 23, timepointWeeks: 4 },
      pValue: 0.003,
    },
    problems: {},
  };
}

function merge<T extends object>(target: T, patch: object): T {
  const out = { ...target } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    const isObject = value !== null && typeof value === 'object';
    out[key] = isObject ? merge(out[key] as object, value) : value;
  }
  return out as T;
}
