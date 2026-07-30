import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { IsEnum, IsObject } from 'class-validator';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiProperty } from '@nestjs/swagger';
import { QueueService } from './queue.service';
import { JobType } from './queue.constants';
import { Roles } from '../auth/decorators';

export class EnqueueJobDto {
  @ApiProperty({ enum: Object.values(JobType), example: JobType.CERTIFICATE_GENERATION })
  @IsEnum(JobType)
  type: JobType;

  @ApiProperty({ example: { projectId: 'proj-001', amount: 1000 } })
  @IsObject()
  payload: Record<string, unknown>;
}

@ApiTags('Queue')
@Controller('queue')
@Roles('admin')
export class QueueController {
  constructor(private readonly queueService: QueueService) {}

  @Post('jobs')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Enqueue a background job (admin only)' })
  @ApiResponse({ status: 201, description: 'Job enqueued — returns job ID' })
  enqueue(@Body() dto: EnqueueJobDto) {
    return this.queueService.enqueue(dto.type, dto.payload);
  }

  @Get('jobs/:id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get job status by ID' })
  @ApiParam({ name: 'id', example: 'job-001' })
  @ApiResponse({ status: 200, description: 'Job status and result' })
  getJob(@Param('id') id: string) {
    return this.queueService.getJobStatus(id);
  }

  @Get('stats')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get queue statistics (admin only)' })
  @ApiResponse({ status: 200, description: 'Queue depth, active, completed, and failed counts' })
  getStats() {
    return this.queueService.getQueueStats();
  }
}
