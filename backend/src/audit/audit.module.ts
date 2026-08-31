import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditArchiveService } from './audit-archive.service';
import { AuditController } from './audit.controller';
import { PrismaService } from '../prisma.service';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [PoliciesModule],
  providers: [AuditService, AuditArchiveService, PrismaService],
  controllers: [AuditController],
  exports: [AuditService, AuditArchiveService],
})
export class AuditModule {}
