import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ReconciliationService } from './reconciliation.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [ReconciliationService, PrismaService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
