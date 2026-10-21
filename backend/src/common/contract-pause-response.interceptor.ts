import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
  Optional,
} from '@nestjs/common';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { Response } from 'express';
import { PrismaService } from '../prisma.service';

export interface PauseResponseMetadata {
  is_paused: boolean;
  paused_at?: string | null;
  pause_reason?: string | null;
}

/**
 * ContractPauseResponseInterceptor (#1223)
 *
 * Adds pause status information (is_paused, paused_at, pause_reason) to the
 * response metadata of contract-related endpoints without breaking the
 * existing response structure.
 */
@Injectable()
export class ContractPauseResponseInterceptor implements NestInterceptor {
  private cachedStatus: {
    is_paused: boolean;
    paused_at: string | null;
    pause_reason: string | null;
    expiresAt: number;
  } | null = null;

  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async getPauseState(): Promise<{ is_paused: boolean; paused_at: string | null; pause_reason: string | null }> {
    const now = Date.now();
    if (this.cachedStatus && this.cachedStatus.expiresAt > now) {
      return this.cachedStatus;
    }

    let is_paused = false;
    let paused_at: string | null = null;
    let pause_reason: string | null = null;

    if (this.prisma) {
      try {
        // 1. Check AdminConfig (canonical source for emergency pause)
        if (this.prisma.adminConfig?.findMany) {
          const rows = await this.prisma.adminConfig.findMany({
            where: {
              key: {
                in: [
                  'carbon_credit_paused',
                  'carbon_credit_paused_until',
                  'carbon_credit_reason',
                  'carbon_marketplace_paused',
                  'carbon_marketplace_paused_until',
                  'carbon_marketplace_reason',
                  'pause:is_paused',
                ],
              },
            },
          });
          const map = new Map(rows.map((r) => [r.key, r.value]));
          const nowSec = now / 1000;

          const creditPaused =
            map.get('carbon_credit_paused') === 'true' &&
            Number(map.get('carbon_credit_paused_until') ?? 0) > nowSec;
          const marketPaused =
            map.get('carbon_marketplace_paused') === 'true' &&
            Number(map.get('carbon_marketplace_paused_until') ?? 0) > nowSec;
          const generalPaused = map.get('pause:is_paused') === 'true';

          is_paused = creditPaused || marketPaused || generalPaused;
          if (is_paused) {
            pause_reason =
              map.get('carbon_credit_reason') ??
              map.get('carbon_marketplace_reason') ??
              null;
          }
        }

        // 2. Fall back to ContractSyncState if not yet found
        if (!is_paused && (this.prisma as any).contractSyncState?.findFirst) {
          const syncRow = await (this.prisma as any).contractSyncState.findFirst({
            where: { isPaused: true },
            select: { isPaused: true, pauseReason: true, pausedUntil: true },
          });
          if (syncRow && (!syncRow.pausedUntil || new Date(syncRow.pausedUntil) > new Date())) {
            is_paused = true;
            pause_reason = syncRow.pauseReason ?? null;
          }
        }

        // If paused, fetch latest PauseEvent for accurate timestamp and reason
        if (is_paused && (this.prisma as any).pauseEvent?.findFirst) {
          const latest = await (this.prisma as any).pauseEvent.findFirst({
            where: { action: 'pause' },
            orderBy: { occurredAt: 'desc' },
          });
          if (latest) {
            paused_at = latest.occurredAt instanceof Date ? latest.occurredAt.toISOString() : String(latest.occurredAt);
            if (!pause_reason && latest.reason) {
              pause_reason = latest.reason;
            }
          }
        }
      } catch {
        // Fail open
      }
    }

    this.cachedStatus = {
      is_paused,
      paused_at,
      pause_reason,
      expiresAt: now + 5000,
    };

    return this.cachedStatus;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const res = ctx.getResponse<Response>();

    return next.handle().pipe(
      switchMap((data) =>
        from(
          (async () => {
            const pauseInfo = await this.getPauseState();

            // Attach standard HTTP response headers
            if (res && typeof res.setHeader === 'function') {
              res.setHeader('X-Contract-Is-Paused', String(pauseInfo.is_paused));
              if (pauseInfo.is_paused && pauseInfo.paused_at) {
                res.setHeader('X-Contract-Paused-At', pauseInfo.paused_at);
              }
              if (pauseInfo.is_paused && pauseInfo.pause_reason) {
                res.setHeader('X-Contract-Pause-Reason', pauseInfo.pause_reason);
              }
            }

            // Attach pause status information to response body metadata without breaking structure
            if (data && typeof data === 'object') {
              if (Array.isArray(data)) {
                // Attach properties to array object in memory
                (data as any).is_paused = pauseInfo.is_paused;
                if (pauseInfo.is_paused && pauseInfo.paused_at) {
                  (data as any).paused_at = pauseInfo.paused_at;
                }
                if (pauseInfo.is_paused && pauseInfo.pause_reason) {
                  (data as any).pause_reason = pauseInfo.pause_reason;
                }
              } else {
                // Object: attach is_paused, paused_at, pause_reason, and metadata
                data.is_paused = pauseInfo.is_paused;
                if (pauseInfo.is_paused && pauseInfo.paused_at) {
                  data.paused_at = pauseInfo.paused_at;
                }
                if (pauseInfo.is_paused && pauseInfo.pause_reason) {
                  data.pause_reason = pauseInfo.pause_reason;
                }

                if (data.metadata && typeof data.metadata === 'object') {
                  data.metadata.is_paused = pauseInfo.is_paused;
                  if (pauseInfo.is_paused && pauseInfo.paused_at) {
                    data.metadata.paused_at = pauseInfo.paused_at;
                  }
                  if (pauseInfo.is_paused && pauseInfo.pause_reason) {
                    data.metadata.pause_reason = pauseInfo.pause_reason;
                  }
                } else {
                  data.metadata = {
                    is_paused: pauseInfo.is_paused,
                    ...(pauseInfo.is_paused && pauseInfo.paused_at ? { paused_at: pauseInfo.paused_at } : {}),
                    ...(pauseInfo.is_paused && pauseInfo.pause_reason ? { pause_reason: pauseInfo.pause_reason } : {}),
                  };
                }
              }
            }

            return data;
          })(),
        ),
      ),
    );
  }
}
