import { Module } from '@nestjs/common';
import { TemporalService } from './temporal.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [TemporalService],
  exports: [TemporalService],
})
export class TemporalModule {}
