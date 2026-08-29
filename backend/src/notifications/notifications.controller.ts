import { Controller, Get, Patch, Body, Param } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPreferencesDto } from './notifications.dto';
import { Public } from '../auth/decorators';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('preferences/:publicKey')
  getPreferences(@Param('publicKey') publicKey: string) {
    return this.service.getPreferences(publicKey);
  }

  @Patch('preferences/:publicKey')
  updatePreferences(
    @Param('publicKey') publicKey: string,
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.service.updatePreferences(publicKey, dto);
  }

  /** Unsubscribe from all non-critical emails. Accessible without a wallet (used from email links). */
  @Public()
  @Patch('unsubscribe/:publicKey')
  unsubscribe(@Param('publicKey') publicKey: string) {
    return this.service.unsubscribe(publicKey);
  }
}
