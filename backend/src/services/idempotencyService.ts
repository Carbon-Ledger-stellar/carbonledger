import { Injectable } from '@nestjs/common';

export interface StoredIdempotentResponse {
  statusCode: number;
  body: unknown;
  createdAt: number;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required');
    this.name = 'MissingIdempotencyKeyError';
  }
}

@Injectable()
export class IdempotencyService {
  private readonly store = new Map<string, StoredIdempotentResponse>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Validates that an Idempotency-Key header was supplied.
   * Throws MissingIdempotencyKeyError when absent or blank.
   */
  requireKey(key: string | undefined | null): string {
    if (!key || key.trim().length === 0) {
      throw new MissingIdempotencyKeyError();
    }
    return key.trim();
  }

  /**
   * Returns the previously stored response for a key, or null when the key
   * is unknown or has expired (older than the configured TTL).
   */
  get(key: string): StoredIdempotentResponse | null {
    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }
    if (this.isExpired(entry)) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  /**
   * Persists the response produced for a key so duplicate requests can replay it.
   */
  save(key: string, statusCode: number, body: unknown): StoredIdempotentResponse {
    this.evictExpired();
    const entry: StoredIdempotentResponse = {
      statusCode,
      body,
      createdAt: Date.now(),
    };
    this.store.set(key, entry);
    return entry;
  }

  private isExpired(entry: StoredIdempotentResponse): boolean {
    return Date.now() - entry.createdAt >= this.ttlMs;
  }

  private evictExpired(): void {
    for (const [key, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(key);
      }
    }
  }
}
