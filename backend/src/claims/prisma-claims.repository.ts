import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClaimsRepository, type SaveAssessmentInput, type SavedAssessment, type StoredClaim } from './claims.repository.js';

@Injectable()
export class PrismaClaimsRepository extends ClaimsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  findClaim(id: string): Promise<StoredClaim | null> {
    return this.prisma.claim.findUnique({ where: { id }, select: { id: true, text: true, type: true } });
  }

  /**
   * Each branch is ONE atomic write: either the assessment and the claim change are both saved, or neither is.
   * New claim: a single nested create. Existing claim: a two-statement transaction (insert, then status update).
   */
  async saveAssessment(input: SaveAssessmentInput): Promise<SavedAssessment> {
    const data = {
      evidenceTitle: input.evidence.title ?? null,
      evidenceText: input.evidence.text,
      justified: input.decision.justified,
      confidence: input.decision.confidence,
      reasoning: input.decision.reasoning,
      needsReview: input.decision.needsReview,
      checks: json(input.checks),
      extracted: json(input.extracted),
      model: input.meta.model,
      promptVersion: input.meta.promptVersion,
      latencyMs: input.meta.latencyMs,
    };

    if ('existingId' in input.claim) {
      const claimId = input.claim.existingId;
      const [assessment] = await this.prisma.$transaction([
        this.prisma.assessment.create({ data: { ...data, claimId } }),
        this.prisma.claim.update({ where: { id: claimId }, data: { status: 'ASSESSED' } }),
      ]);
      return { id: assessment.id, claimId, createdAt: assessment.createdAt };
    }

    const assessment = await this.prisma.assessment.create({
      data: { ...data, claim: { create: { ...input.claim.create, status: 'ASSESSED' } } },
    });
    return { id: assessment.id, claimId: assessment.claimId, createdAt: assessment.createdAt };
  }
}

/** Our checks and extracted facts are plain data, so they are valid JSON; Prisma's type just cannot see that. */
const json = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
