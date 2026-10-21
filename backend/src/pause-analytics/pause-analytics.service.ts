import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AnalyticsService } from '../analytics/analytics.service';
import { AnalyticsEvent } from '../analytics/analytics.constants';
import {
  ChainPauseEvent,
  PauseAction,
  PauseAnalyticsQuery,
  PauseContract,
  PauseEnding,
  PauseEventRecord,
  PausePeriod,
  PauseSummary,
  UNSPECIFIED_REASON,
} from './pause-analytics.types';

/** Prisma client or interactive-transaction client — both expose the delegate. */
type PauseClient = Pick<PrismaService, 'pauseEvent'>;

export interface RecordReasonInput {
  contract: PauseContract;
  action: PauseAction;
  txHash: string;
  reason: string;
  pausedUntil?: Date;
}

const EXPORT_COLUMNS: Array<keyof PauseEventRecord> = [
  'occurredAt', 'contract', 'action', 'admin', 'reason', 'pausedUntil', 'txHash', 'eventId',
];

/**
 * PauseAnalyticsService (#1324)
 *
 * Records every emergency pause/unpause of the credit and marketplace
 * contracts and derives usage analytics from them: how often contracts are
 * paused, for how long, why, and by whom.
 *
 * Each newly-seen event is also:
 *  - forwarded to AnalyticsService (Segment/Mixpanel) as contract_paused /
 *    contract_unpaused, and
 *  - written as a structured log line (`message.event = "contract_pause"`)
 *    that the Grafana "Emergency Pause Analytics" dashboard queries via Loki
 *    (logging/grafana/dashboards/pause-analytics.json). Reasons get their own
 *    `contract_pause_reason` line because they usually arrive separately.
 */
@Injectable()
export class PauseAnalyticsService {
  private readonly logger = new Logger(PauseAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: AnalyticsService,
  ) {}

  // ── Recording ───────────────────────────────────────────────────────────────

  /**
   * Store an on-chain pause/unpause event. Idempotent: replaying the same
   * event (indexer restart, ledger rescan) only refreshes the chain-derived
   * fields and never re-emits analytics.
   */
  async recordOnChain(event: ChainPauseEvent, client: PauseClient = this.prisma): Promise<void> {
    const where = { txHash_action: { txHash: event.txHash, action: event.action } };
    const chainFields = {
      contract: event.contract,
      admin: event.admin,
      pausedUntil: event.pausedUntil ?? null,
      eventId: event.eventId ?? null,
      occurredAt: event.occurredAt,
    };

    const existing = await client.pauseEvent.findUnique({ where });
    if (existing) {
      await client.pauseEvent.update({ where, data: chainFields });
      return;
    }

    const created = await client.pauseEvent.create({
      data: { ...chainFields, action: event.action, txHash: event.txHash },
    });
    await this.emit(created, client);
  }

  /**
   * Attach an admin-supplied reason to a pause/unpause transaction. The
   * on-chain call carries no reason, so this is the only source of it. If the
   * indexer has not seen the transaction yet, a provisional row is created
   * and later completed by `recordOnChain`.
   */
  async recordReason(input: RecordReasonInput, admin: string): Promise<PauseEventRecord> {
    const where = { txHash_action: { txHash: input.txHash, action: input.action } };
    // Always logged so the dashboard's reason panel sees reasons that arrive
    // after the indexer has already recorded the event.
    this.logger.log({
      event: 'contract_pause_reason',
      contract: input.contract,
      action: input.action,
      reason: input.reason,
      txHash: input.txHash,
    });

    const existing = await this.prisma.pauseEvent.findUnique({ where });
    if (existing) {
      return this.prisma.pauseEvent.update({ where, data: { reason: input.reason } });
    }

    const created = await this.prisma.pauseEvent.create({
      data: {
        contract: input.contract,
        action: input.action,
        admin,
        reason: input.reason,
        pausedUntil: input.action === 'pause' ? input.pausedUntil ?? null : null,
        txHash: input.txHash,
        occurredAt: new Date(),
      },
    });
    await this.emit(created, this.prisma);
    return created;
  }

  private async emit(row: PauseEventRecord, client: PauseClient): Promise<void> {
    let pauseDurationSeconds: number | null = null;
    if (row.action === 'unpause') {
      const lastPause = await client.pauseEvent.findFirst({
        where: { contract: row.contract, action: 'pause', occurredAt: { lte: row.occurredAt } },
        orderBy: { occurredAt: 'desc' },
      });
      if (lastPause) {
        const end = lastPause.pausedUntil && lastPause.pausedUntil < row.occurredAt
          ? lastPause.pausedUntil
          : row.occurredAt;
        pauseDurationSeconds = seconds(lastPause.occurredAt, end);
      }
    }

    const properties = {
      contract: row.contract,
      admin: row.admin,
      reason: row.reason ?? UNSPECIFIED_REASON,
      txHash: row.txHash,
      occurredAt: row.occurredAt.toISOString(),
      pausedUntil: row.pausedUntil?.toISOString() ?? null,
      requestedSeconds: row.pausedUntil ? seconds(row.occurredAt, row.pausedUntil) : null,
      pauseDurationSeconds,
    };

    this.analytics.track(
      row.admin,
      row.action === 'pause' ? AnalyticsEvent.CONTRACT_PAUSED : AnalyticsEvent.CONTRACT_UNPAUSED,
      properties,
    );
    this.logger.log({ event: 'contract_pause', action: row.action, ...properties });
  }

  // ── Querying ────────────────────────────────────────────────────────────────

  async listEvents(query: PauseAnalyticsQuery): Promise<PauseEventRecord[]> {
    return this.prisma.pauseEvent.findMany({
      where: {
        occurredAt: { gte: query.from, lte: query.to },
        ...(query.contract ? { contract: query.contract } : {}),
      },
      orderBy: { occurredAt: 'asc' },
    });
  }

  async getSummary(query: PauseAnalyticsQuery, now: Date = new Date()): Promise<PauseSummary> {
    const events = await this.listEvents(query);
    return summarize(events, query, now);
  }

  async getReport(query: PauseAnalyticsQuery, now: Date = new Date()): Promise<string> {
    return renderReport(await this.getSummary(query, now));
  }

  async exportEvents(query: PauseAnalyticsQuery, format: 'csv' | 'json'): Promise<string> {
    const events = await this.listEvents(query);
    if (format === 'json') {
      return JSON.stringify(events.map((e) => pick(e, EXPORT_COLUMNS)), null, 2);
    }
    const lines = [EXPORT_COLUMNS.join(',')];
    for (const e of events) {
      lines.push(EXPORT_COLUMNS.map((c) => csvCell(e[c])).join(','));
    }
    return lines.join('\n') + '\n';
  }
}

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

function seconds(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}

function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Reconstruct pause periods per contract from an ordered event stream.
 * A period starts at a pause and ends at whichever comes first: the pause
 * window elapsing, the next unpause (manual), or the next pause (renewed).
 */
export function buildPeriods(events: PauseEventRecord[], now: Date): PausePeriod[] {
  const periods: PausePeriod[] = [];
  const open = new Map<string, PauseEventRecord>();

  const close = (start: PauseEventRecord, at: Date, cause: PauseEnding) => {
    const expired = start.pausedUntil !== null && start.pausedUntil <= at;
    const end = expired ? start.pausedUntil! : at;
    periods.push({
      contract: start.contract,
      admin: start.admin,
      reason: start.reason ?? UNSPECIFIED_REASON,
      txHash: start.txHash,
      startedAt: start.occurredAt.toISOString(),
      endedAt: end.toISOString(),
      requestedSeconds: start.pausedUntil ? seconds(start.occurredAt, start.pausedUntil) : null,
      durationSeconds: seconds(start.occurredAt, end),
      endedBy: expired ? 'expired' : cause,
    });
  };

  const ordered = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  for (const e of ordered) {
    const current = open.get(e.contract);
    if (e.action === 'pause') {
      if (current) close(current, e.occurredAt, 'renewed');
      open.set(e.contract, e);
    } else if (current) {
      close(current, e.occurredAt, 'manual');
      open.delete(e.contract);
    }
  }
  for (const start of open.values()) close(start, now, 'ongoing');

  return periods.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function summarize(
  events: PauseEventRecord[],
  query: PauseAnalyticsQuery,
  now: Date,
): PauseSummary {
  const pauses = events.filter((e) => e.action === 'pause');
  const unpauses = events.filter((e) => e.action === 'unpause');

  const byContract: PauseSummary['byContract'] = {};
  const admins = new Map<string, { admin: string; pauses: number; unpauses: number }>();
  const reasons = new Map<string, number>();
  const perDay = new Map<string, number>();

  for (const e of events) {
    const c = (byContract[e.contract] ??= { pauses: 0, unpauses: 0 });
    const a = admins.get(e.admin) ?? { admin: e.admin, pauses: 0, unpauses: 0 };
    admins.set(e.admin, a);
    if (e.action === 'pause') {
      c.pauses++;
      a.pauses++;
      const reason = e.reason?.trim() || UNSPECIFIED_REASON;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      const day = e.occurredAt.toISOString().slice(0, 10);
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    } else {
      c.unpauses++;
      a.unpauses++;
    }
  }

  const periods = buildPeriods(events, now);
  const durations = periods.map((p) => p.durationSeconds).sort((a, b) => a - b);
  const total = durations.reduce((s, d) => s + d, 0);
  const byEnding: Record<PauseEnding, number> = { manual: 0, expired: 0, renewed: 0, ongoing: 0 };
  for (const p of periods) byEnding[p.endedBy]++;

  return {
    window: {
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      contract: query.contract ?? 'all',
    },
    totals: { pauses: pauses.length, unpauses: unpauses.length },
    byContract,
    frequency: [...perDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, n]) => ({ date, pauses: n })),
    durations: {
      count: durations.length,
      meanSeconds: durations.length ? Math.round(total / durations.length) : 0,
      medianSeconds: median(durations),
      maxSeconds: durations.length ? durations[durations.length - 1] : 0,
      totalSeconds: total,
      byEnding,
    },
    reasons: [...reasons.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => ({ reason, count })),
    admins: [...admins.values()].sort((a, b) => b.pauses - a.pauses || a.admin.localeCompare(b.admin)),
    periods,
  };
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

export function renderReport(summary: PauseSummary): string {
  const { window: w, totals, durations: d } = summary;
  const out: string[] = [
    '# Emergency Pause Analytics Report',
    '',
    `Window: ${w.from} → ${w.to} · Contract: ${w.contract}`,
    '',
    '## Overview',
    '',
    '| Metric | Value |',
    '|---|---|',
    `| Pauses | ${totals.pauses} |`,
    `| Unpauses | ${totals.unpauses} |`,
    `| Pause periods | ${d.count} |`,
    `| Mean duration | ${formatDuration(d.meanSeconds)} |`,
    `| Median duration | ${formatDuration(d.medianSeconds)} |`,
    `| Longest pause | ${formatDuration(d.maxSeconds)} |`,
    `| Total time paused | ${formatDuration(d.totalSeconds)} |`,
    '',
    '## How pauses ended',
    '',
    '| Ending | Count |',
    '|---|---|',
    ...(Object.keys(d.byEnding) as PauseEnding[]).map((k) => `| ${k} | ${d.byEnding[k]} |`),
    '',
    '## By contract',
    '',
    '| Contract | Pauses | Unpauses |',
    '|---|---|---|',
    ...Object.entries(summary.byContract).map(([c, v]) => `| ${c} | ${v.pauses} | ${v.unpauses} |`),
    '',
    '## Reasons',
    '',
    '| Reason | Pauses |',
    '|---|---|',
    ...summary.reasons.map((r) => `| ${escapeCell(r.reason)} | ${r.count} |`),
    '',
    '## Admins',
    '',
    '| Admin | Pauses | Unpauses |',
    '|---|---|---|',
    ...summary.admins.map((a) => `| \`${a.admin}\` | ${a.pauses} | ${a.unpauses} |`),
    '',
    '## Pause periods',
    '',
    '| Contract | Started | Duration | Requested | Ended by | Reason |',
    '|---|---|---|---|---|---|',
    ...summary.periods.map(
      (p) =>
        `| ${p.contract} | ${p.startedAt} | ${formatDuration(p.durationSeconds)} | ` +
        `${p.requestedSeconds === null ? '—' : formatDuration(p.requestedSeconds)} | ` +
        `${p.endedBy} | ${escapeCell(p.reason)} |`,
    ),
    '',
  ];
  return out.join('\n');
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
