import {
  SetMetadata,
  Injectable,
  CanActivate,
  ExecutionContext,
  NestMiddleware,
  HttpStatus,
  HttpException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../prisma.service';

export const BYPASS_PAUSE_KEY = 'bypassPause';

/**
 * Decorator to bypass the contract pause check for specific routes or controllers (#1224).
 */
export const BypassPause = () => SetMetadata(BYPASS_PAUSE_KEY, true);

export interface PauseCheckResult {
  is_paused: boolean;
  pause_reason: string | null;
}

/**
 * Helper to inspect the current on-chain and cached pause state via Prisma.
 */
export async function getContractPauseStatus(prisma?: PrismaService | null): Promise<PauseCheckResult> {
  if (!prisma) {
    return { is_paused: false, pause_reason: null };
  }

  try {
    // 1. Check ContractSyncState (updated by background contract sync service)
    if ((prisma as any).contractSyncState?.findFirst) {
      const syncRow = await (prisma as any).contractSyncState.findFirst({
        where: { isPaused: true },
        select: { isPaused: true, pauseReason: true, pausedUntil: true },
      });
      if (syncRow && (!syncRow.pausedUntil || new Date(syncRow.pausedUntil) > new Date())) {
        return { is_paused: true, pause_reason: syncRow.pauseReason ?? null };
      }
    }

    // 2. Check AdminConfig rows (written by PauseService during emergency pause)
    if (prisma.adminConfig?.findMany) {
      const rows = await prisma.adminConfig.findMany({
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
      const nowSec = Date.now() / 1000;

      const creditPaused = map.get('carbon_credit_paused') === 'true';
      const creditUntil = Number(map.get('carbon_credit_paused_until') ?? 0);
      if (creditPaused && (creditUntil === 0 || creditUntil > nowSec)) {
        return { is_paused: true, pause_reason: map.get('carbon_credit_reason') ?? null };
      }

      const marketPaused = map.get('carbon_marketplace_paused') === 'true';
      const marketUntil = Number(map.get('carbon_marketplace_paused_until') ?? 0);
      if (marketPaused && (marketUntil === 0 || marketUntil > nowSec)) {
        return { is_paused: true, pause_reason: map.get('carbon_marketplace_reason') ?? null };
      }

      if (map.get('pause:is_paused') === 'true') {
        return { is_paused: true, pause_reason: null };
      }
    }
  } catch {
    // Fail open on database error to avoid blocking valid traffic if DB unreachable
  }

  return { is_paused: false, pause_reason: null };
}

/**
 * Format a 409 Conflict HttpException for contract pause states.
 */
export function createPauseConflictException(pauseReason: string | null): HttpException {
  const errorMsg = pauseReason
    ? `Contract operations are paused: ${pauseReason}. State-mutating requests are temporarily rejected.`
    : 'Contract operations are currently paused. State-mutating requests are temporarily rejected.';

  return new HttpException(
    {
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      message: errorMsg,
      pause_reason: pauseReason,
    },
    HttpStatus.CONFLICT,
  );
}

/**
 * PauseGuard (#1224)
 *
 * Automatically rejects state-mutating requests (POST, PUT, DELETE, PATCH)
 * with 409 Conflict when contract operations are paused.
 *
 * Can be bypassed for:
 * - Safe methods (GET, HEAD, OPTIONS)
 * - Specific endpoints decorated with @BypassPause()
 * - Admin operations (/admin routes or admin role)
 * - Authentication endpoints (/auth routes)
 */
@Injectable()
export class PauseGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(PrismaService) private readonly prisma?: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request?.method?.toUpperCase() ?? 'GET';

    // 1. Only reject state-mutating requests (POST, PUT, DELETE, PATCH)
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return true;
    }

    // 2. Check for explicit @BypassPause() decorator on handler or controller class
    const isBypassed = this.reflector.getAllAndOverride<boolean>(BYPASS_PAUSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isBypassed) {
      return true;
    }

    // 3. Bypass for admin operations (admins must be able to unpause or manage system)
    const url = request?.originalUrl ?? request?.url ?? '';
    const userRole = (request as any)?.user?.role;
    if (url.includes('/admin') || userRole === 'admin') {
      return true;
    }

    // 4. Bypass for authentication and health check routes
    if (url.includes('/auth') || url.includes('/health') || url.includes('/metrics')) {
      return true;
    }

    // 5. Query pause status
    const { is_paused, pause_reason } = await getContractPauseStatus(this.prisma);
    if (is_paused) {
      throw createPauseConflictException(pause_reason);
    }

    return true;
  }
}

/**
 * PauseMiddleware (#1224)
 *
 * Express-compatible middleware equivalent of PauseGuard.
 */
@Injectable()
export class PauseMiddleware implements NestMiddleware {
  constructor(@Optional() @Inject(PrismaService) private readonly prisma?: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const method = req?.method?.toUpperCase() ?? 'GET';

    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return next();
    }

    const url = req?.originalUrl ?? req?.url ?? '';
    const userRole = (req as any)?.user?.role;
    if (url.includes('/admin') || url.includes('/auth') || userRole === 'admin') {
      return next();
    }

    const { is_paused, pause_reason } = await getContractPauseStatus(this.prisma);
    if (is_paused) {
      const errorMsg = pause_reason
        ? `Contract operations are paused: ${pause_reason}. State-mutating requests are temporarily rejected.`
        : 'Contract operations are currently paused. State-mutating requests are temporarily rejected.';

      res.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: errorMsg,
        pause_reason: pause_reason,
      });
      return;
    }

    next();
  }
}
