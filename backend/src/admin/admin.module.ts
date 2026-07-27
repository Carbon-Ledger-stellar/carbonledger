import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { IndexerModule } from '../indexer/indexer.module';
import { OracleModule } from '../oracle/oracle.module';
import { PrismaService } from '../prisma.service';
import { StellarNetworkService } from '../common/stellar-network.service';
// AdminController is guarded by RolesGuard, which injects JwtService.
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [IndexerModule, OracleModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminService, PrismaService, StellarNetworkService],
})
export class AdminModule {}
