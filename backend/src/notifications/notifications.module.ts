import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { VerificationDeadlineScheduler } from './verification-deadline.scheduler';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // AuthModule exports the JwtService the gateway uses to verify handshakes.
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsGateway,
    VerificationDeadlineScheduler,
    PrismaService,
  ],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
