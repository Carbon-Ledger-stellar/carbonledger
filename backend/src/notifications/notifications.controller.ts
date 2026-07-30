import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Request,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPreferencesDto } from './notifications.dto';
import { AbilityFactory } from '../policies/ability.factory';
import { NotificationSubject } from '../policies';
import { subject } from '@casl/ability';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly abilityFactory: AbilityFactory,
  ) {}

  /**
   * GET /notifications/preferences/:publicKey
   *
   * ABAC condition: user may only read their own preferences.
   */
  @Get('preferences/:publicKey')
  async getPreferences(@Param('publicKey') publicKey: string, @Request() req: any) {
    const ability = this.abilityFactory.createForUser(req.user);
    if (ability.cannot('read', subject(NotificationSubject, { ownerPublicKey: publicKey }))) {
      throw new ForbiddenException('Access denied');
    }
    return this.service.getPreferences(publicKey);
  }

  /**
   * PATCH /notifications/preferences/:publicKey
   *
   * ABAC condition: user may only update their own preferences.
   */
  @Patch('preferences/:publicKey')
  async updatePreferences(
    @Param('publicKey') publicKey: string,
    @Body() dto: UpdateNotificationPreferencesDto,
    @Request() req: any,
  ) {
    const ability = this.abilityFactory.createForUser(req.user);
    if (ability.cannot('update', subject(NotificationSubject, { ownerPublicKey: publicKey }))) {
      throw new ForbiddenException('Access denied');
    }
    return this.service.updatePreferences(publicKey, dto);
  }
}
