import {
  Controller,
  Get,
  Post,
  Param,
  Res,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { Roles } from '../auth/decorators';
import { SerialReconciliationService } from './serial-reconciliation.service';

/**
 * Serial range reconciliation endpoints — admin only.
 *
 * POST /admin/reconciliation/serial-ranges
 *   Enqueues a BullMQ reconciliation job and returns the jobId.
 *
 * GET /admin/reconciliation/:jobId
 *   Polls job status; returns the report when complete.
 *
 * GET /admin/reconciliation/:jobId/export
 *   Returns the completed report as a CSV download.
 */
@Controller('admin/reconciliation')
@Roles('admin')
export class SerialReconciliationController {
  constructor(private readonly svc: SerialReconciliationService) {}

  @Post('serial-ranges')
  @HttpCode(HttpStatus.ACCEPTED)
  async startReconciliation() {
    return this.svc.enqueueReconciliation();
  }

  @Get(':jobId')
  async getJobStatus(@Param('jobId') jobId: string) {
    const result = await this.svc.getJobStatus(jobId);
    if (result.status === 'not_found') {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    return result;
  }

  @Get(':jobId/export')
  async exportCsv(@Param('jobId') jobId: string, @Res() res: Response) {
    const statusResult = await this.svc.getJobStatus(jobId);
    if (statusResult.status === 'not_found') {
      throw new NotFoundException(`Job ${jobId} not found`);
    }
    if (statusResult.status !== 'completed') {
      throw new BadRequestException(
        `Job ${jobId} is not yet complete (status: ${statusResult.status})`,
      );
    }

    const csv = await this.svc.exportJobAsCsv(jobId);
    const filename = `serial-reconciliation-${jobId}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
