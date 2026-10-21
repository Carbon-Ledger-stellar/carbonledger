import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PoliciesModule } from '../policies/policies.module';
import { AdminExperimentsController, ExperimentsController } from './experiments.controller';
import { ExperimentsService } from './experiments.service';

@Module({
  imports: [AuthModule, PoliciesModule],
  controllers: [ExperimentsController, AdminExperimentsController],
  providers: [ExperimentsService, PrismaService],
  exports: [ExperimentsService],
})
export class ExperimentsModule {}
