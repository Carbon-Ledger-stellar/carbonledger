import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { SerialReconciliationService, SERIAL_RECONCILIATION_QUEUE } from './serial-reconciliation.service';
import { SerialReconciliationProcessor } from './serial-reconciliation.processor';
import { SerialReconciliationController } from './serial-reconciliation.controller';
import { IndexerModule } from '../indexer/indexer.module';
import { OracleModule } from '../oracle/oracle.module';
import { PrismaService } from '../prisma.service';
import { StellarNetworkService } from '../common/stellar-network.service';
import { RedisModule } from '../redis.module';
import { AuthModule } from '../auth/auth.module';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: SERIAL_RECONCILIATION_QUEUE }),
    IndexerModule,
    OracleModule,
    RedisModule,
    AuthModule,
    PoliciesModule,
  ],
  controllers: [AdminController, SerialReconciliationController],
  providers: [
    AdminService,
    PrismaService,
    StellarNetworkService,
    SerialReconciliationService,
    SerialReconciliationProcessor,
  ],
})
export class AdminModule {}
