import { Module } from '@nestjs/common';
import { ContractStatusController } from './contract-status.controller';
import { ContractStatusService } from './contract-status.service';
import { PrismaService } from '../prisma.service';

/**
 * ContractStatusModule — exposes the public GET /contract/status endpoint (#1220).
 *
 * No authentication guard is registered here; the endpoint is intentionally
 * public.  The global RolesGuard (APP_GUARD) only activates when a route
 * carries a @Roles() decorator, so unannotated routes remain open.
 */
@Module({
  controllers: [ContractStatusController],
  providers: [ContractStatusService, PrismaService],
})
export class ContractStatusModule {}
