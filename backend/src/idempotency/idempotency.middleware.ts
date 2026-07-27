import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';

/**
 * IdempotencyMiddleware
 *
 * Intercepts POST requests that carry an `Idempotency-Key` header and
 * deduplicates retries within a 24-hour window.
 *
 * Protocol:
 *  1. Client sends `Idempotency-Key: <uuid-v4>` with a POST request.
 *  2. First execution: middleware passes the request through, intercepts the
 *     response, and stores (key, endpoint, requestHash, status, body) in
 *     the database.
 *  3. Subsequent requests with the same key:
 *     - Same body → return the cached response immediately (HTTP 200 with
 *       `Idempotent-Replayed: true` header).
 *     - Different body → HTTP 422 Unprocessable Entity.
 *  4. Records expire after 24 hours.
 *
 * Error responses:
 *  - 400 if the key format is invalid (not a UUID v4).
 *  - 422 if the key was already used with a different request body.
 */

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000; // 24 hours

function hashBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
}

function normaliseEndpoint(req: Request): string {
  return `${req.method}:${req.path}`;
}

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawKey = req.headers['idempotency-key'] as string | undefined;

    // No header → pass through (idempotency is optional / opt-in)
    if (!rawKey) {
      return next();
    }

    // Validate key format (UUID v4)
    if (!UUID_V4_RE.test(rawKey)) {
      throw new BadRequestException(
        'Idempotency-Key must be a valid UUID v4 (e.g. 550e8400-e29b-41d4-a716-446655440000)',
      );
    }

    const endpoint = normaliseEndpoint(req);
    const requestHash = hashBody(req.body);

    // Prune expired records opportunistically (non-blocking)
    this.pruneExpired().catch((err) =>
      this.logger.warn(`Prune failed: ${(err as Error).message}`),
    );

    // Look up existing record
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { idempotencyKey_endpoint: { idempotencyKey: rawKey, endpoint } },
    });

    if (existing) {
      // Check TTL
      const age = Date.now() - existing.createdAt.getTime();
      if (age > IDEMPOTENCY_TTL_MS) {
        // Expired record — treat as a new request (delete and continue)
        await this.prisma.idempotencyRecord
          .delete({ where: { id: existing.id } })
          .catch(() => undefined);
      } else if (existing.requestHash !== requestHash) {
        // Same key, different body — protocol violation
        res.status(422).json({
          statusCode: 422,
          error: 'Unprocessable Entity',
          message:
            'Idempotency-Key has already been used with a different request body.',
        });
        return;
      } else {
        // Replay cached response
        this.logger.debug(
          `Replaying idempotent response for key=${rawKey} endpoint=${endpoint}`,
        );
        res.setHeader('Idempotent-Replayed', 'true');
        if (existing.txHash) {
          res.setHeader('X-Tx-Hash', existing.txHash);
        }
        res.status(existing.responseStatus).json(
          JSON.parse(existing.responseBody),
        );
        return;
      }
    }

    // First execution — intercept the response to save it
    const originalJson = res.json.bind(res);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    res.json = function (body: unknown) {
      // Only persist successful responses (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const txHash: string | undefined =
          body && typeof body === 'object'
            ? (body as Record<string, unknown>).txHash as string | undefined
            : undefined;

        self.prisma.idempotencyRecord
          .create({
            data: {
              idempotencyKey: rawKey,
              endpoint,
              requestHash,
              responseStatus: res.statusCode,
              responseBody: JSON.stringify(body),
              txHash: txHash ?? null,
            },
          })
          .catch((err) =>
            self.logger.error(
              `Failed to persist idempotency record: ${(err as Error).message}`,
            ),
          );
      }
      return originalJson(body);
    };

    next();
  }

  /** Remove records older than 24 hours (best-effort background cleanup). */
  private async pruneExpired(): Promise<void> {
    const cutoff = new Date(Date.now() - IDEMPOTENCY_TTL_MS);
    await this.prisma.idempotencyRecord.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
  }
}
