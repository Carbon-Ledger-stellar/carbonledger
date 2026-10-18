import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MailModule } from '../mail/mail.module';
import { PauseAlertService } from './pause-alert.service';

/**
 * PauseAlertModule (#1367)
 *
 * Provides `PauseAlertService`, which dispatches Slack, PagerDuty, and
 * email notifications whenever a Soroban contract enters or exits emergency
 * pause mode.
 *
 * Exported so any module that records pause events (e.g. PauseAnalyticsModule,
 * AdminModule) can inject PauseAlertService without re-importing the module.
 */
@Module({
  imports: [
    // ConfigModule must be globally available (registered in AppModule), but
    // we import it here for explicit dependency documentation.
    ConfigModule,
    // MailModule provides the BullMQ-backed MailService for email delivery.
    MailModule,
  ],
  providers: [PauseAlertService],
  exports: [PauseAlertService],
})
export class PauseAlertModule {}
