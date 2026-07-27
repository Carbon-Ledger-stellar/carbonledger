import { Controller, Get, Patch, Body, Param } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPreferencesDto } from './notifications.dto';

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
}
