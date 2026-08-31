import { Global, Module } from '@nestjs/common';
import { EventSourcingService } from './event-sourcing.service';
import { AuditController } from './audit.controller';
import { PrismaService } from '../prisma.service';

/**
 * EventSourcingModule is @Global so EventSourcingService can be injected into
 * CreditsModule and MarketplaceModule without importing EventSourcingModule
 * there explicitly.
 */
@Global()
@Module({
  providers:   [EventSourcingService, PrismaService],
  controllers: [AuditController],
  exports:     [EventSourcingService],
})
export class EventSourcingModule {}
