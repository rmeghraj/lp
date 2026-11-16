import { runChecks } from './run-checks.js';
import { POLICY } from './policy.js';
import { makeFacts } from './testing/fixtures.js';
import type { CheckId, CheckResult } from './types.js';

function find(checks: CheckResult[], id: CheckId): CheckResult {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check with id ${id}`);
  return found;
}

describe('runChecks (efficacy claims)', () => {
  it('passes every check for a strong, controlled study', () => {
    const checks = runChecks(makeFacts(), 'EFFICACY');

    expect(checks.map((c) => [c.id, c.status])).toEqual([
      ['effect_size', 'pass'],
      ['timeframe', 'pass'],
      ['significance', 'pass'],
      ['sample_size', 'pass'],
      ['endpoint_match', 'pass'],
      ['control_group', 'pass'],
    ]);
  });

  it('treats only the control group as advisory; the rest can veto', () => {
    const checks = runChecks(makeFacts(), 'EFFICACY');

    expect(checks.filter((c) => !c.critical).map((c) => c.id)).toEqual(['control_group']);
  });

  describe('effect_size', () => {
    it.each([
      { observed: 23, want: 'pass' },
      { observed: 20, want: 'pass' }, // exactly the claimed size is enough
      { observed: 12, want: 'fail' },
    ] as const)('is $want when the study shows a $observed% decrease against a 20% claim', ({ observed, want }) => {
      const checks = runChecks(makeFacts({ study: { effect: { percent: observed } } }), 'EFFICACY');

      expect(find(checks, 'effect_size').status).toBe(want);
    });

    it('fails when the study shows the opposite direction, however large the change', () => {
      const facts = makeFacts({ study: { effect: { direction: 'increase', percent: 40 } } });

      expect(find(runChecks(facts, 'EFFICACY'), 'effect_size').status).toBe('fail');
    });

    it('fails when the study found no change', () => {
      const facts = makeFacts({ study: { effect: { direction: 'no_change', percent: 0 } } });

      expect(find(runChecks(facts, 'EFFICACY'), 'effect_size').status).toBe('fail');
    });

    it('is unknown when the study does not state the size of the effect', () => {
      const facts = makeFacts({ study: { effect: { direction: null, percent: null, timepointWeeks: null } } });

      expect(find(runChecks(facts, 'EFFICACY'), 'effect_size').status).toBe('unknown');
    });

    it('is unknown, not skipped, when the claimed percentage could not be read reliably', () => {
      const facts = makeFacts({
        claim: { magnitudePercent: null },
        problems: { claimMagnitude: 'The number 2 does not appear in the claim text' },
      });

      expect(find(runChecks(facts, 'EFFICACY'), 'effect_size').status).toBe('unknown');
    });

    it('is not applicable when the claim states no percentage', () => {
      const facts = makeFacts({ claim: { magnitudePercent: null } });

      expect(find(runChecks(facts, 'EFFICACY'), 'effect_size').status).toBe('not_applicable');
    });

    it('shows both numbers so the evaluator can see the gap', () => {
      const facts = makeFacts({ study: { effect: { percent: 12 } } });

      const detail = find(runChecks(facts, 'EFFICACY'), 'effect_size').detail;

      expect(detail).toContain('12');
      expect(detail).toContain('20');
    });

    it('says why a value is unknown when its quote could not be verified', () => {
      const facts = makeFacts({
        study: { effect: { direction: null, percent: null, timepointWeeks: null } },
        problems: { effect: 'The quoted text was not found in the study' },
      });

      expect(find(runChecks(facts, 'EFFICACY'), 'effect_size').detail).toContain('not found in the study');
    });
  });

  describe('timeframe', () => {
    it.each([
      { measuredAtWeek: 4, want: 'pass' }, // at the claimed time
      { measuredAtWeek: 2, want: 'pass' }, // earlier is fine
      { measuredAtWeek: 8, want: 'fail' }, // a week-8 result does not support "in 4 weeks"
    ] as const)('is $want when the effect was measured at week $measuredAtWeek against a 4-week claim', ({ measuredAtWeek, want }) => {
      const facts = makeFacts({ study: { effect: { timepointWeeks: measuredAtWeek } } });

      expect(find(runChecks(facts, 'EFFICACY'), 'timeframe').status).toBe(want);
    });

    it('is unknown when the study does not say when the effect was measured', () => {
      const facts = makeFacts({ study: { effect: { timepointWeeks: null } } });

      expect(find(runChecks(facts, 'EFFICACY'), 'timeframe').status).toBe('unknown');
    });

    it('is unknown, not skipped, when the claimed timeframe could not be read reliably', () => {
      const facts = makeFacts({
        claim: { timeframeWeeks: null },
        problems: { claimTimeframe: 'The number 6 does not appear in the claim text' },
      });

      expect(find(runChecks(facts, 'EFFICACY'), 'timeframe').status).toBe('unknown');
    });

    it('is not applicable when the claim states no timeframe', () => {
      const facts = makeFacts({ claim: { timeframeWeeks: null } });

      expect(find(runChecks(facts, 'EFFICACY'), 'timeframe').status).toBe('not_applicable');
    });
  });

  describe('significance', () => {
    it.each([
      { name: 'well below the threshold', p: POLICY.maxPValue / 10, want: 'pass' },
      { name: 'exactly at the threshold (needs to be strictly below)', p: POLICY.maxPValue, want: 'fail' },
      { name: 'above the threshold', p: 0.4, want: 'fail' },
    ] as const)('is $want when p is $name', ({ p, want }) => {
      const checks = runChecks(makeFacts({ study: { pValue: p } }), 'EFFICACY');

      expect(find(checks, 'significance').status).toBe(want);
    });

    it('is unknown when no p-value is stated', () => {
      const checks = runChecks(makeFacts({ study: { pValue: null } }), 'EFFICACY');

      expect(find(checks, 'significance').status).toBe('unknown');
    });
  });

  describe('sample_size', () => {
    it.each([
      { name: 'just enough', n: POLICY.minSampleSize, want: 'pass' },
      { name: 'one too few', n: POLICY.minSampleSize - 1, want: 'fail' },
    ] as const)('is $want when the panel is $name', ({ n, want }) => {
      const checks = runChecks(makeFacts({ study: { sampleSize: n } }), 'EFFICACY');

      expect(find(checks, 'sample_size').status).toBe(want);
    });

    it('is unknown when the panel size is not stated', () => {
      const checks = runChecks(makeFacts({ study: { sampleSize: null } }), 'EFFICACY');

      expect(find(checks, 'sample_size').status).toBe('unknown');
    });
  });

  describe('endpoint_match', () => {
    it.each([
      { judged: true, want: 'pass' },
      { judged: false, want: 'fail' },
      { judged: null, want: 'unknown' },
    ] as const)('is $want when the model judged the endpoint match as $judged', ({ judged, want }) => {
      const checks = runChecks(makeFacts({ study: { endpointMatchesClaim: judged } }), 'EFFICACY');

      expect(find(checks, 'endpoint_match').status).toBe(want);
    });
  });

  describe('control_group', () => {
    it.each([
      { design: 'randomized_controlled', want: 'pass' },
      { design: 'controlled', want: 'pass' },
      { design: 'single_arm', want: 'fail' },
      { design: 'unclear', want: 'unknown' },
    ] as const)('is $want for a $design study', ({ design, want }) => {
      const checks = runChecks(makeFacts({ study: { design } }), 'EFFICACY');

      expect(find(checks, 'control_group').status).toBe(want);
    });
  });
});

describe('runChecks (other claim types)', () => {
  it('skips the numeric checks and the control-group check, because the rules only cover efficacy claims', () => {
    // Even with data that would fail every numeric rule, these checks must not run for an ingredient claim.
    const facts = makeFacts({ study: { sampleSize: 3, pValue: 0.9, effect: { percent: 1, timepointWeeks: 30 } } });

    const checks = runChecks(facts, 'INGREDIENT');

    expect(checks.filter((c) => c.status === 'not_applicable').map((c) => c.id)).toEqual([
      'effect_size',
      'timeframe',
      'significance',
      'sample_size',
      'control_group',
    ]);
  });

  it('still asks whether the study measured what the claim is about', () => {
    const facts = makeFacts({ study: { endpointMatchesClaim: false } });

    expect(find(runChecks(facts, 'INGREDIENT'), 'endpoint_match').status).toBe('fail');
  });
});
