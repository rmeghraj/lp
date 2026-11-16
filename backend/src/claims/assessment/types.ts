import type { ClaimType } from '../../generated/prisma/enums.js';
import type { StudyDesign } from '../../llm/llm-output.schema.js';

export type { ClaimType, StudyDesign };

/** Names of the values we may refuse to trust, used to explain why a check is "unknown". */
export type FactName = 'claimMagnitude' | 'claimTimeframe' | 'sampleSize' | 'effect' | 'pValue';

/**
 * The model's extraction after code has verified it: every number is either backed by a quote that
 * really exists in the source text (and converted to weeks where needed), or it is null.
 */
export interface Facts {
  claim: {
    metric: string;
    direction: 'decrease' | 'increase' | 'none';
    magnitudePercent: number | null;
    timeframeWeeks: number | null;
  };
  study: {
    design: StudyDesign;
    endpointMatchesClaim: boolean | null;
    sampleSize: number | null;
    effect: {
      direction: 'decrease' | 'increase' | 'no_change' | null;
      percent: number | null;
      timepointWeeks: number | null;
    };
    pValue: number | null;
  };
  /** Values the model reported but code refused to trust, with the reason. */
  problems: Partial<Record<FactName, string>>;
}

export type CheckId =
  | 'effect_size'
  | 'timeframe'
  | 'significance'
  | 'sample_size'
  | 'endpoint_match'
  | 'control_group';

/** unknown = not stated in the study, or its quote could not be verified. */
export type CheckStatus = 'pass' | 'fail' | 'unknown' | 'not_applicable';

export interface CheckResult {
  id: CheckId;
  label: string;
  /** A critical check that fails (or cannot be confirmed) stops the verdict from being "justified". */
  critical: boolean;
  status: CheckStatus;
  detail: string;
}

export interface Decision {
  justified: boolean;
  /** 0 to 1, two decimals. A heuristic, not a probability (see DESIGN.md section 6). */
  confidence: number;
  needsReview: boolean;
  reasoning: string;
}
