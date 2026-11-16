import { POLICY } from './policy.js';
import type { CheckId, CheckResult, CheckStatus, ClaimType, Facts } from './types.js';

/** Absorbs floating-point noise when comparing numbers (for example 19.999999999 vs 20). */
const EPSILON = 1e-9;

/**
 * The rule-based part of an assessment. Pure: same facts in, same checks out.
 * Rules only cover EFFICACY claims; other claim types skip the numeric checks and are handled
 * conservatively by `decide` (capped confidence, human review).
 */
export function runChecks(facts: Facts, claimType: ClaimType): CheckResult[] {
  const efficacy = claimType === 'EFFICACY';
  return [
    effectSize(facts, efficacy),
    timeframe(facts, efficacy),
    significance(facts, efficacy),
    sampleSize(facts, efficacy),
    endpointMatch(facts),
    controlGroup(facts, efficacy),
  ];
}

function effectSize(facts: Facts, efficacy: boolean): CheckResult {
  const make = maker('effect_size', 'Effect reaches the claimed size', true);
  if (!efficacy) return make('not_applicable', NOT_COVERED);

  const claimed = facts.claim.magnitudePercent;
  if (claimed === null) {
    return facts.problems.claimMagnitude
      ? make('unknown', facts.problems.claimMagnitude)
      : make('not_applicable', 'The claim does not state a percentage.');
  }

  const { direction, percent } = facts.study.effect;
  if (direction === null || percent === null) {
    return make('unknown', facts.problems.effect ?? 'The study does not state the size of the effect.');
  }
  if (direction === 'no_change') return make('fail', 'The study found no change.');
  if (facts.claim.direction !== 'none' && direction !== facts.claim.direction) {
    return make('fail', `The change goes the opposite way: the study shows ${direction}, the claim promises ${facts.claim.direction}.`);
  }

  const detail = `Observed ${percent}% ${direction}; the claim needs at least ${claimed}%.`;
  return make(percent >= claimed - EPSILON ? 'pass' : 'fail', detail);
}

function timeframe(facts: Facts, efficacy: boolean): CheckResult {
  const make = maker('timeframe', 'Effect shown within the claimed time', true);
  if (!efficacy) return make('not_applicable', NOT_COVERED);

  const claimed = facts.claim.timeframeWeeks;
  if (claimed === null) {
    return facts.problems.claimTimeframe
      ? make('unknown', facts.problems.claimTimeframe)
      : make('not_applicable', 'The claim states no timeframe.');
  }

  const measured = facts.study.effect.timepointWeeks;
  if (measured === null) {
    return make('unknown', facts.problems.effect ?? 'The study does not say when the effect was measured.');
  }

  const detail = `Effect measured at week ${shown(measured)}; the claim promises it within ${shown(claimed)} weeks.`;
  return make(measured <= claimed + EPSILON ? 'pass' : 'fail', detail);
}

function significance(facts: Facts, efficacy: boolean): CheckResult {
  const make = maker('significance', 'Result is statistically significant', true);
  if (!efficacy) return make('not_applicable', NOT_COVERED);

  const p = facts.study.pValue;
  if (p === null) return make('unknown', facts.problems.pValue ?? 'No p-value is stated.');

  return make(p < POLICY.maxPValue ? 'pass' : 'fail', `p = ${p}; it needs to be below ${POLICY.maxPValue}.`);
}

function sampleSize(facts: Facts, efficacy: boolean): CheckResult {
  const make = maker('sample_size', 'Panel is large enough', true);
  if (!efficacy) return make('not_applicable', NOT_COVERED);

  const n = facts.study.sampleSize;
  if (n === null) return make('unknown', facts.problems.sampleSize ?? 'The number of participants is not stated.');

  return make(n >= POLICY.minSampleSize ? 'pass' : 'fail', `${n} participants; the minimum is ${POLICY.minSampleSize}.`);
}

function endpointMatch(facts: Facts): CheckResult {
  const make = maker('endpoint_match', 'Study measured what the claim is about', true);
  switch (facts.study.endpointMatchesClaim) {
    case true:
      return make('pass', 'What the study measured matches what the claim is about.');
    case false:
      return make('fail', 'The study measured something different from what the claim is about.');
    default:
      return make('unknown', 'The study does not say clearly what was measured.');
  }
}

/** Advisory only: a missing control group raises a review flag but never vetoes by itself. */
function controlGroup(facts: Facts, efficacy: boolean): CheckResult {
  const make = maker('control_group', 'Compared with a control group', false);
  if (!efficacy) return make('not_applicable', NOT_COVERED);

  switch (facts.study.design) {
    case 'randomized_controlled':
    case 'controlled':
      return make('pass', 'The study compared the product with a control.');
    case 'single_arm':
      return make('fail', "No control group: results are compared only with the volunteers' own starting point.");
    default:
      return make('unknown', 'It is not clear whether a control group was used.');
  }
}

const NOT_COVERED = 'Rule-based checks only cover efficacy claims.';

function maker(id: CheckId, label: string, critical: boolean) {
  return (status: CheckStatus, detail: string): CheckResult => ({ id, label, critical, status, detail });
}

/** One decimal at most, so 4.333333 weeks reads as 4.3. */
function shown(weeks: number): number {
  return Number(weeks.toFixed(1));
}
