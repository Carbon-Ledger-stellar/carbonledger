import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Delete,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { AdminGuard } from '../auth/guards/admin.guard';

@Controller('webhooks')
export class WebhookController {
  constructor(private readonly webhookService: WebhookService) {}

  @Post()
  async create(@Body() dto: CreateWebhookDto) {
    return this.webhookService.create(dto);
  }

  @Get()
  async findAll() {
    return this.webhookService.findAll();
  }

  @Get('dead-letter')
  @UseGuards(AdminGuard)
  async listDeadLetter() {
    return this.webhookService.listDeadLetter();
  }

  @Post('dead-letter/:id/replay')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async replayDeadLetter(@Param('id') id: string) {
    const replayed = await this.webhookService.replayDeadLetter(id);
    if (!replayed) {
      throw new NotFoundException(`Dead-lettered webhook ${id} not found`);
    }
    return replayed;
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.webhookService.remove(id);
  }
}
