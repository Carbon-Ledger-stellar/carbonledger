import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { EventSourcingService } from './event-sourcing.service';

/**
 * AuditController exposes the credit event log & projections for external consumers.
 *
 * All routes are read-only and unauthenticated — the audit trail is
 * intentionally public so regulators and investors can verify credit history
 * without a wallet.
 *
 * ## Routes
 *
 *   GET /api/v1/audit/credits/:batchId/events
 *     Query the full event log for a credit batch.
 *     Optional query params: from (ISO), to (ISO)
 *
 *   GET /api/v1/audit/credits/:batchId/state
 *     Reconstruct the state of a credit batch at a given point in time.
 *     Required query param: asOf (ISO timestamp)
 *
 *   GET /api/v1/audit/credits/:batchId/projection
 *     Serve the current state from event-sourced projection read model.
 *
 *   POST /api/v1/audit/credits/projections/rebuild
 *     Rebuild all projection read models by replaying event store log.
 *
 *   GET /api/v1/audit/credits/:batchId/integrity
 *     Verify HMAC signatures of all events — returns any tampered events.
 */
@Controller('audit/credits')
export class AuditController {
  constructor(private readonly events: EventSourcingService) {}

  /**
   * GET /api/v1/audit/credits/:batchId/events
   */
  @Get(':batchId/events')
  async getEvents(
    @Param('batchId') batchId: string,
    @Query('from')    from?: string,
    @Query('to')      to?: string,
  ) {
    const opts: { from?: Date; to?: Date } = {};

    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid "from" date');
      opts.from = d;
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid "to" date');
      opts.to = d;
    }

    const eventList = await this.events.getEventsForBatch(batchId, opts);
    return {
      batchId,
      count:  eventList.length,
      events: eventList,
    };
  }

  /**
   * GET /api/v1/audit/credits/:batchId/state?asOf=<ISO>
   */
  @Get(':batchId/state')
  async getStateAt(
    @Param('batchId') batchId: string,
    @Query('asOf')    asOf?: string,
  ) {
    if (!asOf) {
      throw new BadRequestException('"asOf" query parameter is required (ISO 8601 timestamp)');
    }
    const asOfDate = new Date(asOf);
    if (isNaN(asOfDate.getTime())) {
      throw new BadRequestException('Invalid "asOf" date');
    }

    const state = await this.events.reconstructState(batchId, asOfDate);
    return {
      batchId,
      asOf:  asOfDate.toISOString(),
      state: state ?? null,
    };
  }

  /**
   * GET /api/v1/audit/credits/:batchId/projection
   *
   * Serves credit read state directly from projection derived from event log.
   */
  @Get(':batchId/projection')
  async getProjection(@Param('batchId') batchId: string) {
    const projection = await this.events.getProjection(batchId);
    if (!projection) {
      throw new NotFoundException(`No projection found for credit batch ${batchId}`);
    }
    return {
      batchId,
      projection,
    };
  }

  /**
   * POST /api/v1/audit/credits/projections/rebuild
   *
   * Triggers a complete projection rebuild by replaying all historical event logs.
   */
  @Post('projections/rebuild')
  async rebuildProjections() {
    const result = await this.events.rebuildProjections();
    return {
      message: 'Projections successfully rebuilt from event log',
      ...result,
    };
  }

  /**
   * GET /api/v1/audit/credits/:batchId/integrity
   */
  @Get(':batchId/integrity')
  async checkIntegrity(@Param('batchId') batchId: string) {
    const result = await this.events.auditIntegrity(batchId);
    return {
      batchId,
      clean:    result.tampered.length === 0,
      tampered: result.tampered.map((e) => e.id),
    };
  }
}
