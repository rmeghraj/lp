import { BadGatewayException, BadRequestException, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { LlmOutput } from '../llm/llm-output.schema.js';
import { LlmOutputError, LlmUnavailableError } from '../llm/llm.provider.js';
import { CLAIM_TEXT, EVIDENCE_TEXT, makeOutput } from './assessment/testing/fixtures.js';
import { ClaimsService } from './claims.service.js';
import { InMemoryClaimsRepository, StubLlmProvider } from './testing/doubles.js';

beforeAll(() => {
  Logger.overrideLogger(false); // the service logs warnings on purpose; keep the test output clean
});

const newClaim = { claim: { text: CLAIM_TEXT, type: 'EFFICACY' as const }, evidence: { text: EVIDENCE_TEXT } };

function setup(reply: () => LlmOutput = () => makeOutput()) {
  const llm = new StubLlmProvider(reply);
  const repo = new InMemoryClaimsRepository();
  return { llm, repo, service: new ClaimsService(llm, repo) };
}

describe('ClaimsService.assess', () => {
  it('assesses a new claim and saves one assessment with everything needed to explain it later', async () => {
    const { service, repo } = setup();

    const result = await service.assess(newClaim);

    expect(result).toMatchObject({
      id: 'assessment-1',
      claimId: 'new-claim-id',
      justified: true,
      confidence: 0.9,
      needsReview: false,
      reasoning: 'The study supports the claim.',
      claimUnderstood: { metric: 'wrinkle depth', direction: 'decrease', magnitudePercent: 20, timeframeWeeks: 4 },
      model: 'stub-model',
      promptVersion: 'stub@1',
    });
    expect(result.checks.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);

    expect(repo.saved).toHaveLength(1);
    const saved = repo.saved[0];
    expect(saved.claim).toEqual({ create: { text: CLAIM_TEXT, type: 'EFFICACY' } });
    expect(saved.evidence.text).toBe(EVIDENCE_TEXT);
    expect(saved.decision.justified).toBe(true);
    expect(saved.meta.model).toBe('stub-model');
    expect(saved.extracted.modelOutput).toEqual(makeOutput()); // the model's raw answer, untouched
    expect(saved.extracted.facts.study.sampleSize).toBe(45); // and what survived verification
  });

  it('gives the model the claim and the study text exactly as supplied', async () => {
    const { service, llm } = setup();

    await service.assess(newClaim);

    expect(llm.calls).toEqual([{ claimText: CLAIM_TEXT, evidenceText: EVIDENCE_TEXT }]);
  });

  it('uses the stored claim text and type when given a claimId, and attaches the assessment to that claim', async () => {
    const { service, llm, repo } = setup();
    repo.claims.set('c-1', { id: 'c-1', text: CLAIM_TEXT, type: 'INGREDIENT' });

    const result = await service.assess({ claimId: 'c-1', evidence: { text: EVIDENCE_TEXT } });

    expect(llm.calls[0].claimText).toBe(CLAIM_TEXT);
    expect(repo.saved[0].claim).toEqual({ existingId: 'c-1' });
    expect(result.claimId).toBe('c-1');
    // The stored type (INGREDIENT) governs, so the efficacy-only numeric rules are skipped.
    expect(result.checks.find((c) => c.id === 'effect_size')?.status).toBe('not_applicable');
  });

  it('answers 404 for an unknown claimId, before spending anything on the model', async () => {
    const { service, llm, repo } = setup();

    await expect(service.assess({ claimId: 'missing', evidence: { text: EVIDENCE_TEXT } })).rejects.toBeInstanceOf(NotFoundException);

    expect(llm.calls).toHaveLength(0);
    expect(repo.saved).toHaveLength(0);
  });

  it('answers 400 when given neither a claimId nor a claim, even if called without the validation pipe', async () => {
    const { service, llm } = setup();

    await expect(service.assess({ evidence: { text: EVIDENCE_TEXT } })).rejects.toBeInstanceOf(BadRequestException);

    expect(llm.calls).toHaveLength(0);
  });

  describe('when the model cannot give a usable answer, nothing is saved', () => {
    it('answers 503 when the provider is unavailable, without leaking vendor detail', async () => {
      const { service, repo } = setup(() => {
        throw new LlmUnavailableError('down', { cause: new Error('secret-vendor-detail') });
      });

      const failure: unknown = await service.assess(newClaim).then(
        () => undefined,
        (e: unknown) => e,
      );

      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      expect((failure as Error).message).not.toContain('secret-vendor-detail');
      expect(repo.saved).toHaveLength(0);
    });

    it.each(['refusal', 'truncated', 'content_filter', 'invalid', 'empty'] as const)(
      'answers 502 when the model output is unusable (%s)',
      async (problem) => {
        const { service, repo } = setup(() => {
          throw new LlmOutputError(problem, 'unusable');
        });

        await expect(service.assess(newClaim)).rejects.toBeInstanceOf(BadGatewayException);

        expect(repo.saved).toHaveLength(0);
      },
    );

    it('does not disguise a programming error as a model problem', async () => {
      const { service } = setup(() => {
        throw new TypeError('x is not a function');
      });

      await expect(service.assess(newClaim)).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe('the model is not trusted', () => {
    it('does not let a model that says "yes" approve a study whose numbers fail, and says so', async () => {
      const weakEvidence =
        'Randomised vehicle-controlled study of 45 women. At week 4, wrinkle depth was reduced by 12% from baseline (p = 0.003).';
      const hijacked = makeOutput({
        study: { effect: { percent: 12, quote: 'At week 4, wrinkle depth was reduced by 12% from baseline' } },
        verdict: { justified: true, confidence: 0.99, reasoning: 'The study fully justifies the claim.' },
      });
      const { service } = setup(() => hijacked);

      const result = await service.assess({ claim: newClaim.claim, evidence: { text: weakEvidence } });

      const effectSize = result.checks.find((c) => c.id === 'effect_size');
      expect(effectSize?.status).toBe('fail');
      expect(result.justified).toBe(false);
      expect(result.needsReview).toBe(true);
      expect(result.confidence).toBeLessThanOrEqual(0.5);
      expect(result.reasoning).toContain(effectSize?.label); // names what blocked it
      expect(result.reasoning).toContain('The study fully justifies the claim.'); // and keeps what the model said
    });

    it('treats a number backed by an invented quote as unknown, so it cannot produce a confident "yes"', async () => {
      const invented = makeOutput({ study: { pValue: { value: 0.001, quote: 'p < 0.001 in every analysis' } } });
      const { service } = setup(() => invented);

      const result = await service.assess(newClaim);

      expect(result.checks.find((c) => c.id === 'significance')?.status).toBe('unknown');
      expect(result.justified).toBe(false);
      expect(result.needsReview).toBe(true);
    });
  });
});
