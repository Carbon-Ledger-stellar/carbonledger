import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ContractStatusDto } from './contract-status.dto';

/** AdminConfig keys written by PauseService when pausing/unpausing. */
const PAUSED_KEY = 'carbon_credit_paused';
const PAUSED_UNTIL_KEY = 'carbon_credit_paused_until';

/**
 * ContractStatusService — assembles the public contract status response (#1220).
 *
 * Data sources:
 *   - `AdminConfig` (keys: carbon_credit_paused, carbon_credit_paused_until)
 *     Written by PauseService after every successful on-chain pause/unpause.
 *     This is the authoritative source for `is_paused`.
 *
 *   - `PauseEvent` (table: pause_events)
 *     Written by PauseService for every pause action.  The most recent "pause"
 *     row provides `paused_at`, `paused_by` (admin field), and `reason`.
 *
 * The service is intentionally read-only and makes no RPC calls.
 */
@Injectable()
export class ContractStatusService {
  private readonly logger = new Logger(ContractStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the current contract status.
   *
   * Algorithm:
   * 1. Read AdminConfig to determine whether the contract is effectively
   *    paused right now (paused=true AND pausedUntil > now).
   * 2. If paused, find the most recent `pause` PauseEvent row to surface
   *    paused_at, paused_by (admin), and reason.
   * 3. If not paused (or never paused), return null for those fields.
   */
  async getContractStatus(): Promise<ContractStatusDto> {
    // 1. Determine effective pause state from AdminConfig.
    const [pausedRow, untilRow] = await Promise.all([
      this.prisma.adminConfig.findUnique({ where: { key: PAUSED_KEY } }),
      this.prisma.adminConfig.findUnique({ where: { key: PAUSED_UNTIL_KEY } }),
    ]);

    const pausedUntilTimestamp = untilRow ? Number(untilRow.value) : 0;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const isPaused =
      pausedRow?.value === 'true' && pausedUntilTimestamp > nowSeconds;

    if (!isPaused) {
      return {
        is_paused: false,
        paused_at: null,
        paused_by: null,
        reason: null,
      };
    }

    // 2. Fetch the most recent pause event for audit trail fields.
    let paused_at: string | null = null;
    let paused_by: string | null = null;
    let reason: string | null = null;

    try {
      const latestPauseEvent = await this.prisma.pauseEvent.findFirst({
        where: { contract: 'credit', action: 'pause' },
        orderBy: { occurredAt: 'desc' },
        select: {
          admin: true,
          reason: true,
          occurredAt: true,
        },
      });

      if (latestPauseEvent) {
        paused_at = latestPauseEvent.occurredAt.toISOString();
        paused_by = latestPauseEvent.admin;
        reason = latestPauseEvent.reason ?? null;
      }
    } catch (err) {
      // PauseEvent table may not yet have rows (e.g. in tests or on first
      // deployment).  Log a warning but continue — the is_paused field
      // is still correct.
      this.logger.warn(
        `Could not fetch latest pause event: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      is_paused: true,
      paused_at,
      paused_by,
      reason,
    };
  }
}
