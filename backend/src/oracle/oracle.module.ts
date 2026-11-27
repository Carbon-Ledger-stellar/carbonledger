import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: QUEUE_NAME }),
    PoliciesModule,
    ConfigModule,
  ],
  controllers: [OracleController],
  providers: [
      OracleService,
      OracleGuard,
      OracleSyncService,
      OracleSchedulerService,
      OracleContractClient,
      PrismaService,
      {
        provide: 'MAX_PRICE_AGE_SECONDS',
        useFactory: (config: ConfigService) => config.get<number>('MAX_PRICE_AGE_SECONDS', 300),
        inject: [ConfigService],
      },
    ],
  exports: [OracleService],
})
export class OracleModule {}
