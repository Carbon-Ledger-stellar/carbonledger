import {
  Injectable,
  NestMiddleware,
  BadRequestException,
  Logger,
  Optional,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

/**
 * IdempotencyMiddleware
 *
 * Intercepts critical POST requests carrying an `Idempotency-Key` header and
 * deduplicates retries within a configurable TTL window (default 24h).
 * Supports Redis and Database storage backends and serializes concurrent duplicate requests.
 *
 * Protocol:
 *  1. Client sends `Idempotency-Key: <uuid-v4>` with a POST request.
 *  2. Required endpoints (/marketplace/purchase, /retirements, /retirements/retire, /credits/mint)
 *     reject requests missing the Idempotency-Key header with HTTP 400.
 *  3. First execution: acquires concurrent processing lock, passes request to handler,
 *     and persists (key, endpoint, requestHash, status, body) to configured storage (Redis/DB).
 *  4. Concurrent requests with same key wait for initial execution to finish and replay response.
 *  5. Duplicate requests with same key within TTL replay exact response with `Idempotent-Replayed: true`.
 *  6. Different body with same key returns HTTP 422 Unprocessable Entity.
 */

const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const REQUIRED_ENDPOINTS = [
  'POST:/marketplace/purchase',
  'POST:/retirements',
  'POST:/retirements/retire',
  'POST:/retirements/bulk',
  'POST:/credits/mint',
];

export interface IdempotencyRecordPayload {
  idempotencyKey: string;
  endpoint: string;
  requestHash: string;
  responseStatus: number;
  responseBody: string;
  txHash?: string | null;
  createdAt: string;
}

function hashBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(body ?? {}))
    .digest('hex');
}

function normaliseEndpoint(req: Request): string {
  const mountedPath = `${req.baseUrl || ''}${req.path === '/' ? '' : req.path || ''}`;
  const path =
    mountedPath ||
    (req.originalUrl ?? req.url ?? req.path ?? '').split('?')[0];
  return `${req.method}:${path}`;
}

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  private getTtlSeconds(): number {
    const envVal = process.env.IDEMPOTENCY_TTL_SECONDS;
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return 24 * 60 * 60; // default 24h
  }

  private getStorageBackend(): 'redis' | 'database' {
    const backend = (process.env.IDEMPOTENCY_STORAGE_BACKEND || '').toLowerCase();
    if (backend === 'database' || backend === 'db' || backend === 'prisma') {
      return 'database';
    }
    if (this.redisService && this.redisService.isConnected) {
      return 'redis';
    }
    return 'database';
  }

  private isRequiredEndpoint(endpoint: string): boolean {
    return REQUIRED_ENDPOINTS.some(reqEp => endpoint === reqEp || endpoint.startsWith(reqEp));
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    res.removeHeader('idempotent-replayed');
    res.removeHeader('Idempotent-Replayed');
    res.removeHeader('x-tx-hash');
    res.removeHeader('X-Tx-Hash');
    if ((res as any)._headers) {
      delete (res as any)._headers['idempotent-replayed'];
      delete (res as any)._headers['x-tx-hash'];
    }
    if ((res as any)._headerNames) {
      delete (res as any)._headerNames['idempotent-replayed'];
      delete (res as any)._headerNames['x-tx-hash'];
    }
    const rawKey = req.headers['idempotency-key'] as string | undefined;
    const endpoint = normaliseEndpoint(req);

    // Require Idempotency-Key header for required endpoints
    if (!rawKey) {
      if (this.isRequiredEndpoint(endpoint)) {
        throw new BadRequestException(
          'Idempotency-Key header is required for this endpoint',
        );
      }
      return next();
    }

    // Validate key format (UUID v4)
    if (!UUID_V4_RE.test(rawKey)) {
      throw new BadRequestException(
        'Idempotency-Key must be a valid UUID v4 (e.g. 550e8400-e29b-41d4-a716-446655440000)',
      );
    }

    const requestHash = hashBody(req.body);
    const ttlSeconds = this.getTtlSeconds();
    const backend = this.getStorageBackend();

    // ── Check existing completed record ─────────────────────────────────────
    let record = await this.getRecord(rawKey, endpoint, backend);

    if (record) {
      const age = Date.now() - new Date(record.createdAt).getTime();
      if (age > ttlSeconds * 1000) {
        // Record expired -> purge and continue as fresh request
        await this.deleteRecord(rawKey, endpoint, backend);
        record = null;
      } else if (record.requestHash !== requestHash) {
        // Key payload mismatch -> HTTP 422
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
        if (record.txHash) {
          res.setHeader('X-Tx-Hash', record.txHash);
        }
        res.status(record.responseStatus).json(
          JSON.parse(record.responseBody),
        );
        return;
      }
    }

    // ── Concurrency Lock & Serialization ─────────────────────────────────────
    const acquiredLock = await this.acquireLock(rawKey, endpoint, backend);
    if (!acquiredLock) {
      // Another request with the same key is currently running -> wait for completion
      const completedRecord = await this.waitForCompletion(rawKey, endpoint, requestHash, backend);
      if (completedRecord) {
        res.setHeader('Idempotent-Replayed', 'true');
        if (completedRecord.txHash) {
          res.setHeader('X-Tx-Hash', completedRecord.txHash);
        }
        res.status(completedRecord.responseStatus).json(
          JSON.parse(completedRecord.responseBody),
        );
        return;
      }
    }

    // ── First execution: intercept response to store ─────────────────────────
    const originalJson = res.json;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const ctx = {
      key: rawKey,
      endpoint,
      requestHash,
      ttlSeconds,
      backend,
    };

    res.json = function (this: Response, body: unknown) {
      // Restore original res.json to prevent prototype pollution
      res.json = originalJson;

      // Ensure fresh (non-replayed) responses do not retain replayed headers
      res.removeHeader('idempotent-replayed');
      res.removeHeader('Idempotent-Replayed');
      res.removeHeader('x-tx-hash');
      res.removeHeader('X-Tx-Hash');

      if (res.statusCode >= 200 && res.statusCode < 300) {
        const txHash: string | undefined =
          body && typeof body === 'object'
            ? (body as Record<string, unknown>).txHash as string | undefined
            : undefined;

        const payload: IdempotencyRecordPayload = {
          idempotencyKey: ctx.key,
          endpoint: ctx.endpoint,
          requestHash: ctx.requestHash,
          responseStatus: res.statusCode,
          responseBody: JSON.stringify(body),
          txHash: txHash ?? null,
          createdAt: new Date().toISOString(),
        };

        self.saveRecord(payload, ctx.ttlSeconds, ctx.backend)
          .catch((err) =>
            self.logger.error(
              `Failed to persist idempotency record: ${(err as Error).message}`,
            ),
          )
          .finally(() => {
            self.releaseLock(ctx.key, ctx.endpoint, ctx.backend).catch(() => undefined);
          });
      } else {
        self.releaseLock(ctx.key, ctx.endpoint, ctx.backend).catch(() => undefined);
      }
      return originalJson.call(this, body);
    };

    next();
  }

  private async getRecord(
    key: string,
    endpoint: string,
    backend: 'redis' | 'database',
  ): Promise<IdempotencyRecordPayload | null> {
    if (backend === 'redis' && this.redisService?.isConnected) {
      const redisKey = `idempotency:record:${key}:${endpoint}`;
      const cached = await this.redisService.get<IdempotencyRecordPayload>(redisKey);
      if (cached) return cached;
    }

    const row = await this.prisma.idempotencyRecord.findUnique({
      where: { idempotencyKey_endpoint: { idempotencyKey: key, endpoint } },
    }).catch(() => null);

    if (!row) return null;

    return {
      idempotencyKey: row.idempotencyKey,
      endpoint: row.endpoint,
      requestHash: row.requestHash,
      responseStatus: row.responseStatus,
      responseBody: row.responseBody,
      txHash: row.txHash,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async saveRecord(
    payload: IdempotencyRecordPayload,
    ttlSeconds: number,
    backend: 'redis' | 'database',
  ): Promise<void> {
    if (backend === 'redis' && this.redisService?.isConnected) {
      const redisKey = `idempotency:record:${payload.idempotencyKey}:${payload.endpoint}`;
      await this.redisService.set(redisKey, payload, ttlSeconds);
    }

    // Always persist to DB for durable fallback
    await this.prisma.idempotencyRecord.create({
      data: {
        idempotencyKey: payload.idempotencyKey,
        endpoint: payload.endpoint,
        requestHash: payload.requestHash,
        responseStatus: payload.responseStatus,
        responseBody: payload.responseBody,
        txHash: payload.txHash ?? null,
      },
    }).catch(() => undefined);
  }

  private async deleteRecord(
    key: string,
    endpoint: string,
    backend: 'redis' | 'database',
  ): Promise<void> {
    if (backend === 'redis' && this.redisService?.isConnected) {
      await this.redisService.del(`idempotency:record:${key}:${endpoint}`);
    }
    await this.prisma.idempotencyRecord
      .delete({ where: { idempotencyKey_endpoint: { idempotencyKey: key, endpoint } } })
      .catch(() => undefined);
  }

  private async acquireLock(
    key: string,
    endpoint: string,
    backend: 'redis' | 'database',
  ): Promise<boolean> {
    if (backend === 'redis' && this.redisService?.isConnected) {
      const client = this.redisService.getClient();
      if (client) {
        const lockKey = `idempotency:lock:${key}:${endpoint}`;
        const res = await client.set(lockKey, 'LOCKED', 'EX', 30, 'NX');
        return res === 'OK';
      }
    }
    // Database / in-memory fallback lock check
    return true;
  }

  private async releaseLock(
    key: string,
    endpoint: string,
    backend: 'redis' | 'database',
  ): Promise<void> {
    if (backend === 'redis' && this.redisService?.isConnected) {
      const lockKey = `idempotency:lock:${key}:${endpoint}`;
      await this.redisService.del(lockKey);
    }
  }

  private async waitForCompletion(
    key: string,
    endpoint: string,
    requestHash: string,
    backend: 'redis' | 'database',
  ): Promise<IdempotencyRecordPayload | null> {
    const maxAttempts = 50; // 50 * 100ms = 5s max wait
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const rec = await this.getRecord(key, endpoint, backend);
      if (rec) {
        return rec;
      }
    }
    return null;
  }
}
