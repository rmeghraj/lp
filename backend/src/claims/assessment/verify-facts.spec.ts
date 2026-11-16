import { verifyFacts } from './verify-facts.js';
import { CLAIM_TEXT, EVIDENCE_TEXT, makeOutput } from './testing/fixtures.js';

const source = { claimText: CLAIM_TEXT, evidenceText: EVIDENCE_TEXT };

describe('verifyFacts', () => {
  it('keeps every value whose quote appears in the study text', () => {
    const facts = verifyFacts(makeOutput(), source);

    expect(facts.claim).toEqual({
      metric: 'wrinkle depth',
      direction: 'decrease',
      magnitudePercent: 20,
      timeframeWeeks: 4,
    });
    expect(facts.study.sampleSize).toBe(45);
    expect(facts.study.effect).toEqual({ direction: 'decrease', percent: 23, timepointWeeks: 4 });
    expect(facts.study.pValue).toBe(0.003);
    expect(facts.problems).toEqual({});
  });

  it('matches quotes regardless of case, spacing and line breaks', () => {
    const evidenceText = 'RANDOMISED vehicle-controlled\n\n  STUDY   of 45\nwomen. At week 4, wrinkle depth was reduced by 23% from baseline (p = 0.003).';

    const facts = verifyFacts(makeOutput(), { claimText: CLAIM_TEXT, evidenceText });

    expect(facts.study.sampleSize).toBe(45);
    expect(facts.problems).toEqual({});
  });

  it('matches quotes when the model straightens curly apostrophes', () => {
    const evidenceText = 'Participants’ wrinkle depth fell by 23% by week 4. n = 45.';
    const output = makeOutput({
      study: {
        sampleSize: { value: 45, quote: 'n = 45' },
        effect: { quote: "Participants' wrinkle depth fell by 23% by week 4" },
      },
    });

    const facts = verifyFacts(output, { claimText: CLAIM_TEXT, evidenceText });

    expect(facts.study.effect.percent).toBe(23);
    expect(facts.problems.effect).toBeUndefined();
  });

  it('drops a number whose quote is not in the study text, and records why', () => {
    const output = makeOutput({ study: { pValue: { value: 0.001, quote: 'p < 0.001' } } });

    const facts = verifyFacts(output, source);

    expect(facts.study.pValue).toBeNull();
    expect(facts.problems.pValue).toBeTruthy();
    expect(facts.study.sampleSize).toBe(45); // other facts are untouched
  });

  it('drops a number the model gave without any quote', () => {
    const output = makeOutput({ study: { sampleSize: { value: 45, quote: null } } });

    const facts = verifyFacts(output, source);

    expect(facts.study.sampleSize).toBeNull();
    expect(facts.problems.sampleSize).toBeTruthy();
  });

  it('treats a blank quote as no quote at all', () => {
    const output = makeOutput({ study: { sampleSize: { value: 45, quote: '   ' } } });

    const facts = verifyFacts(output, source);

    expect(facts.study.sampleSize).toBeNull();
    expect(facts.problems.sampleSize).toBeTruthy();
  });

  it('does not complain about a value that is legitimately absent', () => {
    const output = makeOutput({ study: { pValue: { value: null, quote: null } } });

    const facts = verifyFacts(output, source);

    expect(facts.study.pValue).toBeNull();
    expect(facts.problems).toEqual({});
  });

  it('drops direction, size and timing together when the effect quote is not in the study text', () => {
    const output = makeOutput({ study: { effect: { quote: 'wrinkle depth fell by 31% at week 8' } } });

    const facts = verifyFacts(output, source);

    expect(facts.study.effect).toEqual({ direction: null, percent: null, timepointWeeks: null });
    expect(facts.problems.effect).toBeTruthy();
  });

  it('drops claim numbers that are not written in the claim text', () => {
    const output = makeOutput({ claim: { magnitudePercent: 2, timeframe: { value: 6, unit: 'weeks' } } });

    const facts = verifyFacts(output, source);

    expect(facts.claim.magnitudePercent).toBeNull();
    expect(facts.claim.timeframeWeeks).toBeNull();
    expect(facts.problems.claimMagnitude).toBeTruthy();
    expect(facts.problems.claimTimeframe).toBeTruthy();
  });

  it.each([
    { unit: 'days', value: 28, weeks: 4 },
    { unit: 'weeks', value: 6, weeks: 6 },
    { unit: 'months', value: 1, weeks: 4.33 },
  ] as const)('converts a study timepoint of $value $unit to $weeks weeks', ({ unit, value, weeks }) => {
    const output = makeOutput({ study: { effect: { timepoint: { value, unit } } } });

    const facts = verifyFacts(output, source);

    expect(facts.study.effect.timepointWeeks).toBeCloseTo(weeks, 2);
  });

  it('converts the claimed timeframe to weeks too', () => {
    const output = makeOutput({ claim: { timeframe: { value: 28, unit: 'days' } } });

    const facts = verifyFacts(output, { claimText: 'Reduces wrinkles by 20% in 28 days', evidenceText: EVIDENCE_TEXT });

    expect(facts.claim.timeframeWeeks).toBe(4);
  });
});
