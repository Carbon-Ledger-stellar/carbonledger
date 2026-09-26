import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma.service';
import { PoliciesModule } from '../policies/policies.module';
import { AbilityFactory } from '../policies/ability.factory';

@Module({
  imports: [PoliciesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PrismaService, AbilityFactory],
  exports: [NotificationsService],
})
export class NotificationsModule {}
