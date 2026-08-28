import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { PrismaService } from '../prisma.service';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [PoliciesModule],
  providers: [AuditService, PrismaService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
