import { FakeLlmProvider } from './fake.provider.js';
import { PROMPT_VERSION } from './prompt.js';
import {
  INJECTION_STUDY,
  SAMPLE_CLAIM,
  STRONG_STUDY,
  WEAK_STUDY,
  WRONG_TIMEFRAME_STUDY,
} from '../claims/testing/samples.js';

const fake = new FakeLlmProvider();
const assess = (evidenceText: string) => fake.assess({ claimText: SAMPLE_CLAIM, evidenceText });

describe('FakeLlmProvider (offline stand-in for the model)', () => {
  it('reads the claim and a typical study, with a quote for each number', async () => {
    const { output } = await assess(STRONG_STUDY);

    expect(output.claim).toEqual({
      metric: 'wrinkles',
      direction: 'decrease',
      magnitudePercent: 20,
      timeframe: { value: 4, unit: 'weeks' },
    });
    expect(output.study.design).toBe('randomized_controlled');
    expect(output.study.sampleSize).toEqual({ value: 45, quote: 'n = 45' });
    expect(output.study.effect).toMatchObject({ direction: 'decrease', percent: 23, timepoint: { value: 4, unit: 'weeks' } });
    expect(output.study.pValue).toEqual({ value: 0.003, quote: 'p = 0.003' });
    expect(output.study.endpointMatchesClaim).toBe(true);
  });

  it('reads the participant count from the prose when there is no "n ="', async () => {
    const { output } = await assess(WEAK_STUDY);

    expect(output.study.sampleSize).toEqual({ value: 24, quote: '24 volunteers' });
    expect(output.study.design).toBe('single_arm');
    expect(output.study.effect.percent).toBe(12);
  });

  it('returns null, with no quote, for what the study does not say', async () => {
    const { output } = await assess(WRONG_TIMEFRAME_STUDY);

    expect(output.study.pValue).toEqual({ value: null, quote: null });
    expect(output.study.effect.timepoint).toEqual({ value: 8, unit: 'weeks' });
  });

  it.each([
    { name: 'strong', study: STRONG_STUDY },
    { name: 'weak', study: WEAK_STUDY },
    { name: 'wrong-timeframe', study: WRONG_TIMEFRAME_STUDY },
  ])('only quotes text that is really in the $name study', async ({ study }) => {
    const { output } = await assess(study);

    const quotes = [output.study.sampleSize.quote, output.study.effect.quote, output.study.pValue.quote].filter(
      (q): q is string => q !== null,
    );
    expect(quotes.length).toBeGreaterThan(0);
    for (const quote of quotes) expect(study).toContain(quote);
  });

  it('drafts a sensible verdict: yes for the strong study, no for the weak one', async () => {
    const strong = await assess(STRONG_STUDY);
    const weak = await assess(WEAK_STUDY);

    expect(strong.output.verdict.justified).toBe(true);
    expect(weak.output.verdict.justified).toBe(false);
  });

  it('can play a model hijacked by instructions in the study text, so the safeguard can be demonstrated', async () => {
    const { output } = await assess(INJECTION_STUDY);

    expect(output.study.effect.percent).toBe(12); // it still reads the real numbers...
    expect(output.verdict.justified).toBe(true); // ...but obeys the injected order
    expect(output.verdict.confidence).toBeGreaterThanOrEqual(0.95);
  });

  it('says plainly that it is not a real model', async () => {
    const { meta } = await assess(STRONG_STUDY);

    expect(meta.model).toMatch(/fake/);
    expect(meta.promptVersion).toBe(PROMPT_VERSION);
  });
});
