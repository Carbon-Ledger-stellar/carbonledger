import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  Request,
  ParseIntPipe,
  DefaultValuePipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { CreateWebhookSubscriptionDto } from './webhook.dto';
import { Roles } from '../auth/decorators';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  /**
   * Register a new webhook subscription.
   *
   * POST /api/v1/webhooks
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('corporation', 'admin')
  subscribe(@Body() dto: CreateWebhookSubscriptionDto) {
    return this.webhookService.subscribe(dto);
  }

  /**
   * List all webhook subscriptions for the authenticated user.
   *
   * GET /api/v1/webhooks
   */
  @Get()
  @Roles('corporation', 'admin')
  listSubscriptions(@Request() req: any) {
    return this.webhookService.listSubscriptions(req.user.publicKey);
  }

  /**
   * Admin-wide webhook delivery log query across all subscriptions.
   *
   * Must be registered before the `:id` route below so Nest's route
   * matching doesn't treat "deliveries" as a subscription id.
   *
   * GET /api/v1/webhooks/deliveries
   */
  @Get('deliveries')
  @Roles('admin')
  getAllDeliveries(
    @Query('subscriptionId') subscriptionId: string | undefined,
    @Query('eventType') eventType: string | undefined,
    @Query('success') success: string | undefined,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.webhookService.getAllDeliveryLogs({
      subscriptionId,
      eventType,
      success: success === undefined ? undefined : success === 'true',
      page,
      pageSize,
    });
  }

  /**
   * Get a single webhook subscription by ID.
   *
   * GET /api/v1/webhooks/:id
   */
  @Get(':id')
  @Roles('corporation', 'admin')
  getSubscription(@Param('id') id: string, @Request() req: any) {
    return this.webhookService.getSubscription(id, req.user.publicKey);
  }

  /**
   * Delete (deactivate) a webhook subscription.
   *
   * DELETE /api/v1/webhooks/:id
   */
  @Delete(':id')
  @Roles('corporation', 'admin')
  unsubscribe(@Param('id') id: string, @Request() req: any) {
    return this.webhookService.unsubscribe(id, req.user.publicKey);
  }

  /**
   * Get delivery logs for a subscription.
   *
   * GET /api/v1/webhooks/:id/logs
   */
  @Get(':id/logs')
  @Roles('corporation', 'admin')
  getDeliveryLogs(
    @Param('id') id: string,
    @Request() req: any,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('pageSize', new DefaultValuePipe(20), ParseIntPipe) pageSize: number,
  ) {
    return this.webhookService.getDeliveryLogs(id, req.user.publicKey, page, pageSize);
  }
}
