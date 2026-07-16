import { Module } from '@nestjs/common';
import { IdempotencyMiddleware } from './idempotency.middleware';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [IdempotencyMiddleware, PrismaService],
  exports: [IdempotencyMiddleware],
})
export class IdempotencyModule {}
