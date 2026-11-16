import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  LlmOutputError,
  LlmProvider,
  LlmUnavailableError,
  type LlmAssessmentInput,
  type LlmAssessmentResult,
} from '../llm/llm.provider.js';
import { decide } from './assessment/decide.js';
import { runChecks } from './assessment/run-checks.js';
import type { CheckResult, ClaimType, Facts } from './assessment/types.js';
import { verifyFacts } from './assessment/verify-facts.js';
import { ClaimsRepository, type ClaimTarget } from './claims.repository.js';
import type { AssessClaimRequest } from './dto/assess-claim.dto.js';

export interface AssessmentResponse {
  id: string;
  claimId: string;
  justified: boolean;
  confidence: number;
  needsReview: boolean;
  reasoning: string;
  /** How the claim was read, shown so the evaluator can spot a misreading at a glance. */
  claimUnderstood: Facts['claim'];
  checks: CheckResult[];
  model: string;
  promptVersion: string;
  createdAt: Date;
}

@Injectable()
export class ClaimsService {
  private readonly logger = new Logger(ClaimsService.name);

  constructor(
    @Inject(LlmProvider) private readonly llm: LlmProvider,
    @Inject(ClaimsRepository) private readonly claims: ClaimsRepository,
  ) {}

  /**
   * The whole feature in five steps. The model call is slow and external, so no database
   * transaction is open while we wait for it, and nothing is saved if it fails.
   * Claim and study text are confidential, so they are never written to the logs.
   */
  async assess(request: AssessClaimRequest): Promise<AssessmentResponse> {
    const claim = await this.resolveClaim(request);
    const evidenceText = request.evidence.text;

    const { output, meta } = await this.askModel({ claimText: claim.text, evidenceText }); // 1. model reads

    const facts = verifyFacts(output, { claimText: claim.text, evidenceText }); //             2. verify its quotes
    const checks = runChecks(facts, claim.type); //                                             3. run the rules
    const decision = decide(output.verdict, checks); //                                         4. combine, code has the last word on "yes"

    const saved = await this.claims.saveAssessment({
      //                                                                                        5. one all-or-nothing write
      claim: claim.target,
      evidence: request.evidence,
      decision,
      checks,
      extracted: { facts, modelOutput: output },
      meta,
    });

    this.logger.log(
      `assessment=${saved.id} claim=${saved.claimId} justified=${decision.justified} confidence=${decision.confidence} ` +
        `review=${decision.needsReview} model=${meta.model} latencyMs=${meta.latencyMs} tokens=${meta.inputTokens ?? '?'}/${meta.outputTokens ?? '?'}`,
    );

    return {
      id: saved.id,
      claimId: saved.claimId,
      justified: decision.justified,
      confidence: decision.confidence,
      needsReview: decision.needsReview,
      reasoning: decision.reasoning,
      claimUnderstood: facts.claim,
      checks,
      model: meta.model,
      promptVersion: meta.promptVersion,
      createdAt: saved.createdAt,
    };
  }

  private async resolveClaim(request: AssessClaimRequest): Promise<{ text: string; type: ClaimType; target: ClaimTarget }> {
    if (request.claimId !== undefined) {
      const stored = await this.claims.findClaim(request.claimId);
      if (!stored) throw new NotFoundException(`Claim ${request.claimId} was not found`);
      return { text: stored.text, type: stored.type, target: { existingId: stored.id } };
    }
    if (request.claim === undefined) {
      // The request schema already forbids this. It is checked again so the service is safe to call from anywhere.
      throw new BadRequestException('Send either claimId (an existing claim) or claim (a new one)');
    }
    const { text, type, productName, formulaRef } = request.claim;
    return { text, type, target: { create: { text, type, productName, formulaRef } } };
  }

  /** Turns the two ways a model call can fail into HTTP answers a client can act on, with no vendor detail. */
  private async askModel(input: LlmAssessmentInput): Promise<LlmAssessmentResult> {
    try {
      return await this.llm.assess(input);
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        this.logger.warn(`Language-model service unavailable: ${reasonOf(error)}`);
        throw new ServiceUnavailableException('The assessment service is temporarily unavailable. Please try again in a moment.');
      }
      if (error instanceof LlmOutputError) {
        this.logger.warn(`Unusable model output (${error.problem}): ${reasonOf(error)}`);
        throw new BadGatewayException('The AI could not produce a usable assessment for this study. Try again, or review it manually.');
      }
      throw error; // anything else is a bug in our code: let it become a 500
    }
  }
}

function reasonOf(error: Error): string {
  return error.cause instanceof Error ? error.cause.message : error.message;
}
