import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { IndexerModule } from '../indexer/indexer.module';
import { OracleModule } from '../oracle/oracle.module';
import { PrismaService } from '../prisma.service';
import { StellarNetworkService } from '../common/stellar-network.service';
import { RedisModule } from '../redis.module';
import { AuthModule } from '../auth/auth.module';
import { PoliciesModule } from '../policies/policies.module';

@Module({
  imports: [IndexerModule, OracleModule, RedisModule, AuthModule, PoliciesModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, StellarNetworkService],
})
export class AdminModule {}
