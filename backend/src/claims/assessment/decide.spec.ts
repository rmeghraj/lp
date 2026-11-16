import { decide } from './decide.js';
import { POLICY } from './policy.js';
import type { CheckId, CheckResult, CheckStatus } from './types.js';

const CRITICAL: Record<CheckId, boolean> = {
  effect_size: true,
  timeframe: true,
  significance: true,
  sample_size: true,
  endpoint_match: true,
  control_group: false,
};

/** Six checks, all passing unless a test says otherwise. */
function checks(statuses: Partial<Record<CheckId, CheckStatus>> = {}): CheckResult[] {
  return (Object.keys(CRITICAL) as CheckId[]).map((id) => ({
    id,
    label: `label for ${id}`,
    critical: CRITICAL[id],
    status: statuses[id] ?? 'pass',
    detail: '',
  }));
}

/** What a claim type without rule coverage looks like: no numeric checks, only the endpoint judgement. */
const NO_RULES: Partial<Record<CheckId, CheckStatus>> = {
  effect_size: 'not_applicable',
  timeframe: 'not_applicable',
  significance: 'not_applicable',
  sample_size: 'not_applicable',
  control_group: 'not_applicable',
};

function verdict(justified: boolean, confidence = 0.9) {
  return { justified, confidence, reasoning: 'Model reasoning.' };
}

describe('decide', () => {
  it('lets the model verdict stand when every check passes', () => {
    expect(decide(verdict(true, 0.9), checks())).toEqual({
      justified: true,
      confidence: 0.9,
      needsReview: false,
      reasoning: 'Model reasoning.',
    });
  });

  it('agrees with a model "no" when a critical check fails, and does not flag it', () => {
    expect(decide(verdict(false, 0.9), checks({ effect_size: 'fail' }))).toEqual({
      justified: false,
      confidence: 0.9,
      needsReview: false,
      reasoning: 'Model reasoning.',
    });
  });

  it('vetoes a model "yes" when a critical check fails, says so, and caps confidence', () => {
    const result = decide(verdict(true, 0.95), checks({ effect_size: 'fail' }));

    expect(result.justified).toBe(false);
    expect(result.confidence).toBe(POLICY.disagreementConfidenceCap);
    expect(result.needsReview).toBe(true);
    expect(result.reasoning).toContain('label for effect_size'); // names the check that blocked it
    expect(result.reasoning).toContain('Model reasoning.'); // and keeps what the model said
  });

  it('refuses a model "yes" when a critical check cannot be confirmed', () => {
    const result = decide(verdict(true, 0.95), checks({ significance: 'unknown' }));

    expect(result.justified).toBe(false);
    expect(result.needsReview).toBe(true);
    expect(result.confidence).toBeLessThanOrEqual(POLICY.disagreementConfidenceCap);
    expect(result.reasoning).toContain('label for significance');
  });

  it('flags a model "no" for review when a critical check cannot be confirmed', () => {
    const result = decide(verdict(false, 0.9), checks({ significance: 'unknown' }));

    expect(result.justified).toBe(false);
    expect(result.needsReview).toBe(true);
  });

  it('caps confidence and asks for review when every check passes but the model says "no"', () => {
    const result = decide(verdict(false, 0.9), checks());

    expect(result.justified).toBe(false);
    expect(result.confidence).toBe(POLICY.disagreementConfidenceCap);
    expect(result.needsReview).toBe(true);
    expect(result.reasoning).toContain('Model reasoning.');
  });

  it('lowers confidence by the share of critical checks that could not be completed', () => {
    // 5 critical checks, 1 unknown: the study is a clear "no" (effect too small) but only 4 of 5 could be read.
    const result = decide(verdict(false, 0.95), checks({ effect_size: 'fail', sample_size: 'unknown' }));

    expect(result.confidence).toBe(0.8);
    expect(result.needsReview).toBe(false);
  });

  it('rounds confidence to two decimals', () => {
    // Critical checks left: significance, sample_size, endpoint_match. One unknown out of three is 2/3.
    const result = decide(
      verdict(false, 0.95),
      checks({ effect_size: 'not_applicable', timeframe: 'not_applicable', significance: 'fail', sample_size: 'unknown' }),
    );

    expect(result.confidence).toBe(0.67);
  });

  it.each([
    { given: 1.4, want: 1 },
    { given: -0.3, want: 0 },
  ])('clamps a model confidence of $given into the 0 to 1 range', ({ given, want }) => {
    expect(decide(verdict(true, given), checks()).confidence).toBe(want);
  });

  it.each([{ modelSaysYes: true }, { modelSaysYes: false }])(
    'caps confidence and asks for review when no rule applies (model says yes: $modelSaysYes)',
    ({ modelSaysYes }) => {
      const result = decide(verdict(modelSaysYes, 0.95), checks(NO_RULES));

      expect(result.justified).toBe(modelSaysYes);
      expect(result.confidence).toBe(POLICY.noRulesConfidenceCap);
      expect(result.needsReview).toBe(true);
    },
  );

  it('never lets the advisory control-group check veto, but does ask for review', () => {
    const result = decide(verdict(true, 0.9), checks({ control_group: 'fail' }));

    expect(result.justified).toBe(true);
    expect(result.confidence).toBe(0.9);
    expect(result.needsReview).toBe(true);
  });

  it.each([
    { name: 'just below the review threshold', confidence: POLICY.reviewBelowConfidence - 0.01, review: true },
    { name: 'exactly at the review threshold', confidence: POLICY.reviewBelowConfidence, review: false },
  ])('asks for review $review when confidence is $name', ({ confidence, review }) => {
    expect(decide(verdict(true, confidence), checks()).needsReview).toBe(review);
  });
});
