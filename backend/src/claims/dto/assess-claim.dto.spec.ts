import { assessClaimSchema, MAX_EVIDENCE_CHARS, MIN_EVIDENCE_CHARS } from './assess-claim.dto.js';

const evidence = { text: 'Randomised study of 45 women. Wrinkle depth fell by 23% at week 4 (p = 0.003).' };
const claim = { text: 'Reduces wrinkles by 20% in 4 weeks' };

describe('assessClaimSchema', () => {
  it('accepts a new claim with evidence, defaults its type to EFFICACY, and trims surrounding whitespace', () => {
    const result = assessClaimSchema.safeParse({
      claim: { text: '  Reduces wrinkles by 20% in 4 weeks  ' },
      evidence: { text: `\n  ${evidence.text}  \n` },
    });

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      claim: { text: 'Reduces wrinkles by 20% in 4 weeks', type: 'EFFICACY' },
      evidence: { text: evidence.text },
    });
  });

  it('accepts an existing claim referenced by id', () => {
    expect(assessClaimSchema.safeParse({ claimId: 'abc-123', evidence }).success).toBe(true);
  });

  it.each([
    { name: 'neither a claimId nor a claim', body: { evidence } },
    { name: 'both a claimId and a claim', body: { claimId: 'abc', claim, evidence } },
    { name: 'no evidence', body: { claim } },
    { name: 'blank claim text', body: { claim: { text: '   ' }, evidence } },
    { name: 'whitespace-only evidence', body: { claim, evidence: { text: ' '.repeat(MIN_EVIDENCE_CHARS + 5) } } },
    { name: 'evidence shorter than the minimum', body: { claim, evidence: { text: 'x'.repeat(MIN_EVIDENCE_CHARS - 1) } } },
    { name: 'evidence longer than the maximum', body: { claim, evidence: { text: 'x'.repeat(MAX_EVIDENCE_CHARS + 1) } } },
    { name: 'an unknown claim type', body: { claim: { ...claim, type: 'MIRACLE' }, evidence } },
    { name: 'fields we do not know about', body: { claim, evidence, isAdmin: true } },
  ])('rejects $name', ({ body }) => {
    expect(assessClaimSchema.safeParse(body).success).toBe(false);
  });

  it.each([
    { name: 'the minimum', length: MIN_EVIDENCE_CHARS },
    { name: 'the maximum', length: MAX_EVIDENCE_CHARS },
  ])('accepts evidence of exactly $name length', ({ length }) => {
    expect(assessClaimSchema.safeParse({ claim, evidence: { text: 'x'.repeat(length) } }).success).toBe(true);
  });
});
