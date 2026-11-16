import type { LlmVerdict } from '../../llm/llm-output.schema.js';
import { POLICY } from './policy.js';
import type { CheckId, CheckResult, Decision } from './types.js';

const NUMERIC_CHECKS: ReadonlySet<CheckId> = new Set(['effect_size', 'timeframe', 'significance', 'sample_size']);

type Outcome = 'pass' | 'fail' | 'unknown' | 'no_rules';

/**
 * Combines the model's draft verdict with the rule checks. The one rule to remember:
 * the model can say "no" on its own, but it can only say "yes" if the code agrees.
 *
 *   critical check failed          -> not justified
 *   critical check unknown         -> not justified ("cannot confirm"), flagged
 *   all pass                       -> the model's verdict stands
 *   no numeric rule applies        -> the model's verdict stands, but confidence is capped and flagged
 *
 * Confidence is the lower of the model's own score and the share of critical checks that could be
 * completed, and is capped further when model and code disagree. It is a heuristic, not a probability.
 */
export function decide(verdict: LlmVerdict, checks: CheckResult[]): Decision {
  const applicable = checks.filter((c) => c.status !== 'not_applicable');
  const critical = applicable.filter((c) => c.critical);
  const failed = critical.filter((c) => c.status === 'fail');
  const unknown = critical.filter((c) => c.status === 'unknown');
  const hasNumericRule = applicable.some((c) => NUMERIC_CHECKS.has(c.id));

  const outcome = outcomeOf(failed, unknown, hasNumericRule);
  const rulesAllowYes = outcome === 'pass' || outcome === 'no_rules';

  const vetoed = verdict.justified && !rulesAllowYes; // the dangerous case: model says yes, code says no
  const modelDissents = !verdict.justified && outcome === 'pass'; // numbers fine, model sees a problem
  const disagreement = vetoed || modelDissents;

  const completeness = critical.length === 0 ? 1 : (critical.length - unknown.length) / critical.length;
  let confidence = Math.min(clamp01(verdict.confidence), completeness);
  if (outcome === 'no_rules') confidence = Math.min(confidence, POLICY.noRulesConfidenceCap);
  if (disagreement) confidence = Math.min(confidence, POLICY.disagreementConfidenceCap);
  confidence = Math.round(confidence * 100) / 100;

  const advisoryConcern = applicable.some((c) => !c.critical && c.status !== 'pass');
  const needsReview =
    confidence < POLICY.reviewBelowConfidence ||
    disagreement ||
    outcome === 'unknown' ||
    outcome === 'no_rules' ||
    advisoryConcern;

  return {
    justified: rulesAllowYes && verdict.justified,
    confidence,
    needsReview,
    reasoning: explain(verdict, { vetoed, modelDissents }, failed, unknown),
  };
}

function outcomeOf(failed: CheckResult[], unknown: CheckResult[], hasNumericRule: boolean): Outcome {
  if (failed.length > 0) return 'fail';
  if (unknown.length > 0) return 'unknown';
  return hasNumericRule ? 'pass' : 'no_rules';
}

/** When the code overrides or doubts the model, the text must say so, so the screen never contradicts itself. */
function explain(
  verdict: LlmVerdict,
  flags: { vetoed: boolean; modelDissents: boolean },
  failed: CheckResult[],
  unknown: CheckResult[],
): string {
  if (flags.vetoed) {
    const parts: string[] = [];
    if (failed.length > 0) parts.push(`failed: ${labels(failed)}`);
    if (unknown.length > 0) parts.push(`could not be confirmed: ${labels(unknown)}`);
    return `Automated checks overrode the model's "justified" verdict (${parts.join('; ')}). Model's reasoning: ${verdict.reasoning}`;
  }
  if (flags.modelDissents) {
    return `The automated checks passed, but the model judged the study insufficient. Model's reasoning: ${verdict.reasoning}`;
  }
  return verdict.reasoning;
}

const labels = (checks: CheckResult[]): string => checks.map((c) => c.label).join(', ');

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
