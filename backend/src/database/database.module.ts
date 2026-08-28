import { Module } from '@nestjs/common';
import { DualReadService } from './dual-read.service';
import { MigrationMonitorService } from './migration-monitor.service';
import { PrismaService } from '../prisma.service';

/**
 * DatabaseModule
 *
 * Exports the zero-downtime migration tooling services so they can be
 * injected into any feature module that is executing a live column migration.
 *
 * To use in a feature module:
 *
 *   @Module({
 *     imports: [DatabaseModule],
 *     // ...
 *   })
 *   export class RetirementsModule {}
 *
 *   // Then inject in a service:
 *   constructor(private readonly dualRead: DualReadService) {}
 */
@Module({
  providers: [PrismaService, DualReadService, MigrationMonitorService],
  exports: [DualReadService, MigrationMonitorService],
})
export class DatabaseModule {}
