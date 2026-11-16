import { z } from 'zod';
import { ClaimType } from '../../generated/prisma/enums.js';

/** Too little text cannot be a study. Too much text is a cost and abuse risk on a paid LLM call. */
export const MIN_EVIDENCE_CHARS = 20;
export const MAX_EVIDENCE_CHARS = 30_000;

const claimInput = z.strictObject({
  text: z.string().trim().min(1).max(500),
  type: z.enum(ClaimType).default('EFFICACY'),
  productName: z.string().trim().min(1).max(120).optional(),
  /** A reference to the formula in the R&I system. The formula itself is never sent here. */
  formulaRef: z.string().trim().min(1).max(64).optional(),
});

const evidenceInput = z.strictObject({
  title: z.string().trim().min(1).max(200).optional(),
  text: z.string().trim().min(MIN_EVIDENCE_CHARS).max(MAX_EVIDENCE_CHARS),
});

/**
 * Body of POST /api/claims/assess: the evidence, plus either an existing claim (by id) or a new one.
 * `strictObject` rejects fields we do not know about instead of silently ignoring them.
 */
export const assessClaimSchema = z
  .strictObject({
    claimId: z.string().trim().min(1).max(64).optional(),
    claim: claimInput.optional(),
    evidence: evidenceInput,
  })
  .refine((body) => (body.claimId === undefined) !== (body.claim === undefined), {
    message: 'Send either claimId (an existing claim) or claim (a new one), not both and not neither',
    path: ['claim'],
  });

export type AssessClaimRequest = z.infer<typeof assessClaimSchema>;
