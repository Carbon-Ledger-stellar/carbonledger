import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IndexerService } from './indexer.service';
import { PrismaService } from '../prisma.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
  ],
  providers: [IndexerService, PrismaService],
  exports: [IndexerService],
})
export class IndexerModule {}
