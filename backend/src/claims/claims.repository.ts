import type { LlmOutput } from '../llm/llm-output.schema.js';
import type { LlmAssessmentResult } from '../llm/llm.provider.js';
import type { CheckResult, ClaimType, Decision, Facts } from './assessment/types.js';

export interface StoredClaim {
  id: string;
  text: string;
  type: ClaimType;
}

/** Either attach the assessment to a claim that already exists, or create the claim along with it. */
export type ClaimTarget =
  | { existingId: string }
  | { create: { text: string; type: ClaimType; productName?: string; formulaRef?: string } };

export interface SaveAssessmentInput {
  claim: ClaimTarget;
  evidence: { title?: string; text: string };
  decision: Decision;
  checks: CheckResult[];
  /** What the model said and what we verified, so "why did it say that?" can be answered months later. */
  extracted: { facts: Facts; modelOutput: LlmOutput };
  meta: LlmAssessmentResult['meta'];
}

export interface SavedAssessment {
  id: string;
  claimId: string;
  createdAt: Date;
}

/** The only door to the database for this feature. Abstract so the service can be tested without one. */
export abstract class ClaimsRepository {
  abstract findClaim(id: string): Promise<StoredClaim | null>;
  /** Saves the assessment and moves its claim to ASSESSED, all or nothing. */
  abstract saveAssessment(input: SaveAssessmentInput): Promise<SavedAssessment>;
}
