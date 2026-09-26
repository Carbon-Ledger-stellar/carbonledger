import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { PrismaService } from '../prisma.service';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [AuditModule, AuthModule, PoliciesModule],
  providers: [ExportService, PrismaService],
  controllers: [ExportController],
})
export class ExportModule {}
