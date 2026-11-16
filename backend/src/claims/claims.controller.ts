import { Body, Controller, Inject, Post } from '@nestjs/common';
import { ClaimsService, type AssessmentResponse } from './claims.service.js';
import { assessClaimSchema, type AssessClaimRequest } from './dto/assess-claim.dto.js';

@Controller('claims')
export class ClaimsController {
  constructor(@Inject(ClaimsService) private readonly service: ClaimsService) {}

  /** POST /api/claims/assess: does this study justify this claim? The body is validated by `assessClaimSchema`. */
  @Post('assess')
  assess(@Body({ schema: assessClaimSchema }) body: AssessClaimRequest): Promise<AssessmentResponse> {
    return this.service.assess(body);
  }
}
