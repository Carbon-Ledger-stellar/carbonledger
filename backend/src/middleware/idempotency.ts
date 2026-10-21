import { Injectable, NestMiddleware, BadRequestException, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

interface StoredResponse {
  statusCode: number;
  body: unknown;
  expiresAt: number;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  private readonly logger = new Logger(IdempotencyMiddleware.name);
  private readonly store = new Map<string, StoredResponse>();

  use(req: Request, res: Response, next: NextFunction): void {
    const key = req.header('Idempotency-Key');

    if (!key || key.trim() === '') {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    this.evictExpired();

    const existing = this.store.get(key);
    if (existing) {
      res.status(existing.statusCode).json(existing.body);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode < 500) {
        this.store.set(key, {
          statusCode: res.statusCode,
          body,
          expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
        });
      }
      return originalJson(body);
    };

    next();
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [key, value] of this.store.entries()) {
      if (value.expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}
