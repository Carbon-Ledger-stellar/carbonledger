import {
  BadRequestException, Body, Controller, Get, Header, Post, Query, Req, Res, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { AuditLogSubject, CheckPolicies, PoliciesGuard } from '../policies';
import { PauseAnalyticsService } from './pause-analytics.service';
import {
  PauseAnalyticsQueryDto, PauseExportQueryDto, RecordPauseReasonDto,
} from './pause-analytics.dto';
import { PauseAnalyticsQuery } from './pause-analytics.types';

const DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Emergency pause analytics (#1324). Admin only.
 *
 *   POST /admin/pause-analytics/events   record the reason for a pause/unpause tx
 *   GET  /admin/pause-analytics/summary  frequency, durations, reasons, admins (JSON)
 *   GET  /admin/pause-analytics/report   the same as a Markdown report
 *   GET  /admin/pause-analytics/export   raw events as CSV (default) or JSON
 */
@Controller('admin/pause-analytics')
@Roles('admin')
@ApiBearerAuth()
@UseGuards(PoliciesGuard)
@CheckPolicies((ability) => ability.can('read', AuditLogSubject))
export class PauseAnalyticsController {
  constructor(private readonly pauseAnalytics: PauseAnalyticsService) {}

  @Post('events')
  recordReason(@Body() dto: RecordPauseReasonDto, @Req() req: any) {
    return this.pauseAnalytics.recordReason(
      {
        contract: dto.contract,
        action: dto.action,
        txHash: dto.txHash.toLowerCase(),
        reason: dto.reason.trim(),
        pausedUntil: dto.pausedUntil ? new Date(dto.pausedUntil) : undefined,
      },
      req.user?.publicKey,
    );
  }

  @Get('summary')
  summary(@Query() query: PauseAnalyticsQueryDto) {
    return this.pauseAnalytics.getSummary(toQuery(query));
  }

  @Get('report')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  report(@Query() query: PauseAnalyticsQueryDto) {
    return this.pauseAnalytics.getReport(toQuery(query));
  }

  @Get('export')
  async export(@Query() query: PauseExportQueryDto, @Res() res: any) {
    const format = query.format ?? 'csv';
    const body = await this.pauseAnalytics.exportEvents(toQuery(query), format);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
    );
    res.setHeader('Content-Disposition', `attachment; filename="pause-events-${stamp}.${format}"`);
    res.send(body);
  }
}

export function toQuery(dto: PauseAnalyticsQueryDto, now: Date = new Date()): PauseAnalyticsQuery {
  const to = dto.to ? new Date(dto.to) : now;
  const from = dto.from ? new Date(dto.from) : new Date(to.getTime() - DEFAULT_WINDOW_MS);
  if (from > to) throw new BadRequestException('`from` must be before `to`');
  return { from, to, contract: dto.contract };
}
