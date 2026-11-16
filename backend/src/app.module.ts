import { Module } from '@nestjs/common';
import { ClaimsModule } from './claims/claims.module.js';
import { ConfigModule } from './config/config.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [ConfigModule, PrismaModule, ClaimsModule],
})
export class AppModule {}
