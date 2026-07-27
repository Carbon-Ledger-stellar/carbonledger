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

  @Get('retirements')
  async exportRetirements(
    @Query() filters: any,
    @Query('format') format = 'json',
    @Req() req: any,
    @Res() res: Response,
  ) {
    const data = await this.exportService.getRetirements(filters);
    await this.auditService.createLog({
      userId: req.user?.publicKey,
      action: 'EXPORT_RETIREMENTS',
      ipAddress: req.ip,
      result: 'Success',
      metadata: { filters, format, count: data.length },
    });
    if (format === 'csv') {
      const csv = this.exportService.toCsv(data);
      res.header('Content-Type', 'text/csv');
      res.attachment(`retirements-export-${Date.now()}.csv`);
      return res.send(csv);
    }
    return res.json(data);
  }
}
