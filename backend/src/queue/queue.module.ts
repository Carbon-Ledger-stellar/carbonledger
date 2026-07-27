import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { QueueProcessor } from './queue.processor';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_NAME } from './queue.constants';
import { PrismaService } from '../prisma.service';
import { RetirementsModule } from '../retirements/retirements.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAME }),
    AuthModule,
    forwardRef(() => RetirementsModule),
  ],
  providers: [QueueService, QueueProcessor, PrismaService],
  controllers: [QueueController],
  exports: [QueueService],
})
export class QueueModule {}
