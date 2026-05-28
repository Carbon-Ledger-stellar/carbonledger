import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaService } from '../prisma.service';

@Module({
  providers: [AuditService, PrismaService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
