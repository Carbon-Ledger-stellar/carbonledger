import { Controller, Get, Query, Res, Req } from '@nestjs/common';
import { Response, Request } from 'express';
import { ExportService } from './export.service';
import { Roles } from '../auth/decorators';
import { AuditService } from '../audit/audit.service';

@Controller('export')
@Roles('admin')
export class ExportController {
  constructor(
    private readonly exportService: ExportService,
    private readonly auditService: AuditService,
  ) {}

  @Get('projects')
  async exportProjects(
    @Query() filters: any,
    @Query('format') format = 'json',
    @Req() req: any,
    @Res() res: Response,
  ) {
    const data = await this.exportService.getProjects(filters);
    await this.auditService.createLog({
      userId: req.user?.publicKey,
      action: 'EXPORT_PROJECTS',
      ipAddress: req.ip,
      result: 'Success',
      metadata: { filters, format, count: data.length },
    });
    if (format === 'csv') {
      const csv = this.exportService.toCsv(data);
      res.header('Content-Type', 'text/csv');
      res.attachment(`projects-export-${Date.now()}.csv`);
      return res.send(csv);
    }
    return res.json(data);
  }

  /**
   * Stream retirement records to avoid OOM on large datasets (#666).
   *
   * Supported formats:
   *   - ndjson (default) — newline-delimited JSON, one record per line
   *   - csv              — comma-separated, streamed row by row
   *   - json             — legacy in-memory JSON array (not recommended for large sets)
   */
  @Get('retirements')
  async exportRetirements(
    @Query() filters: any,
    @Query('format') format = 'ndjson',
    @Req() req: any,
    @Res() res: Response,
  ) {
    await this.auditService.createLog({
      userId: req.user?.publicKey,
      action: 'EXPORT_RETIREMENTS',
      ipAddress: req.ip,
      result: 'Success',
      metadata: { filters, format },
    });

    if (format === 'csv') {
      res.header('Content-Type', 'text/csv');
      res.attachment(`retirements-export-${Date.now()}.csv`);
      return this.exportService.streamRetirementsCsv(filters, res);
    }

    if (format === 'json') {
      // Legacy path — loads everything into memory; not suitable for large datasets
      const data = await this.exportService.getRetirements(filters);
      return res.json(data);
    }

    // Default: NDJSON streaming
    res.header('Content-Type', 'application/x-ndjson');
    res.attachment(`retirements-export-${Date.now()}.ndjson`);
    return this.exportService.streamRetirementsNdjson(filters, res);
  }
}
