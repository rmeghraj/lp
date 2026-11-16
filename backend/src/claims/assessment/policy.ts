/**
 * Illustrative policy parameters for the take-home. In real use the claims-policy owners set these
 * (per market and claim type); they are kept in one place so that is a one-file change.
 */
export const POLICY = {
  /** A result is "significant" only when p is strictly below this. */
  maxPValue: 0.05,
  /** Smallest panel that can support an efficacy claim. */
  minSampleSize: 20,
  /** Below this confidence a human must look at the result. */
  reviewBelowConfidence: 0.7,
  /** With no rule-based check available the model is on its own, so confidence is capped here. */
  noRulesConfidenceCap: 0.6,
  /** When the model and the code disagree, confidence is capped here. */
  disagreementConfidenceCap: 0.5,
} as const;
