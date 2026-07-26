import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OracleController } from './oracle.controller';
import { OracleService } from './oracle.service';
import { OracleGuard } from './oracle.guard';
import { OracleSyncService } from './oracle-sync.service';
import { OracleSchedulerService } from './oracle-scheduler.service';
import { OracleContractClient } from './oracle-contract.client';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_NAME } from '../queue/queue.constants';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: QUEUE_NAME }),
  ],
  controllers: [OracleController],
  providers: [OracleService, OracleGuard, OracleSyncService, OracleSchedulerService, OracleContractClient, PrismaService],
  exports: [OracleService],
})
export class OracleModule {}
