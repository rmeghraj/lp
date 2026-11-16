// Test utility: not part of the production build (excluded in tsconfig.build.json).
import type { LlmOutput } from '../../llm/llm-output.schema.js';
import { LlmProvider, type LlmAssessmentInput, type LlmAssessmentResult } from '../../llm/llm.provider.js';
import { ClaimsRepository, type SaveAssessmentInput, type SavedAssessment, type StoredClaim } from '../claims.repository.js';

/** A model whose answer the test scripts. `reply` may also throw to play a failure. Records every call. */
export class StubLlmProvider extends LlmProvider {
  readonly calls: LlmAssessmentInput[] = [];

  constructor(private readonly reply: () => LlmOutput) {
    super();
  }

  async assess(input: LlmAssessmentInput): Promise<LlmAssessmentResult> {
    this.calls.push(input);
    return { output: this.reply(), meta: { model: 'stub-model', promptVersion: 'stub@1', latencyMs: 5 } };
  }
}

/** Keeps everything in memory so tests can see exactly what would have been saved (or not saved). */
export class InMemoryClaimsRepository extends ClaimsRepository {
  readonly claims = new Map<string, StoredClaim>();
  readonly saved: SaveAssessmentInput[] = [];

  async findClaim(id: string): Promise<StoredClaim | null> {
    return this.claims.get(id) ?? null;
  }

  async saveAssessment(input: SaveAssessmentInput): Promise<SavedAssessment> {
    this.saved.push(input);
    return {
      id: `assessment-${this.saved.length}`,
      claimId: 'existingId' in input.claim ? input.claim.existingId : 'new-claim-id',
      createdAt: new Date('2026-11-14T10:00:00.000Z'),
    };
  }
}
