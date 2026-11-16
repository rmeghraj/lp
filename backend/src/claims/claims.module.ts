import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { ClaimsController } from './claims.controller.js';
import { ClaimsRepository } from './claims.repository.js';
import { ClaimsService } from './claims.service.js';
import { PrismaClaimsRepository } from './prisma-claims.repository.js';

@Module({
  imports: [LlmModule],
  controllers: [ClaimsController],
  providers: [ClaimsService, { provide: ClaimsRepository, useClass: PrismaClaimsRepository }],
})
export class ClaimsModule {}
