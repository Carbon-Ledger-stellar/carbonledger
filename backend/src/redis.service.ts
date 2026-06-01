import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

/**
 * Thin wrapper around ioredis that degrades gracefully when Redis is
 * unavailable.  All public methods return `null` / `false` on error so
 * callers can fall back to the primary data source without crashing.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private connected = false;

  onModuleInit() {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";

    this.client = new Redis(url, {
      // Don't block startup if Redis is down
      lazyConnect:         true,
      enableOfflineQueue:  false,
      maxRetriesPerRequest: 0,
      retryStrategy: (times) => {
        // Exponential back-off capped at 30 s; never throw
        return Math.min(times * 500, 30_000);
      },
    });

    this.client.on("connect", () => {
      this.connected = true;
      this.logger.log("Redis connected");
    });

    this.client.on("error", (err: Error) => {
      if (this.connected) {
        this.logger.warn(`Redis error – falling back to direct reads: ${err.message}`);
      }
      this.connected = false;
    });

    this.client.on("close", () => {
      this.connected = false;
    });

    // Attempt initial connection (non-blocking)
    this.client.connect().catch(() => {
      this.logger.warn("Redis unavailable at startup – caching disabled");
    });
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }

  /** Returns the cached value, or null on miss / error. */
  async get<T>(key: string): Promise<T | null> {
    if (!this.connected || !this.client) return null;
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(`Redis GET failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Stores a value with a TTL in seconds. Returns false on error. */
  async set(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    if (!this.connected || !this.client) return false;
    try {
      await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
      return true;
    } catch (err) {
      this.logger.warn(`Redis SET failed for key "${key}": ${(err as Error).message}`);
      return false;
    }
  }

  /** Deletes one or more keys. Returns false on error. */
  async del(...keys: string[]): Promise<boolean> {
    if (!this.connected || !this.client || keys.length === 0) return false;
    try {
      await this.client.del(...keys);
      return true;
    } catch (err) {
      this.logger.warn(`Redis DEL failed for keys [${keys.join(", ")}]: ${(err as Error).message}`);
      return false;
    }
  }

  /** Deletes all keys matching a glob pattern. Returns false on error. */
  async delByPattern(pattern: string): Promise<boolean> {
    if (!this.connected || !this.client) return false;
    try {
      // SCAN is non-blocking and safe for production use
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== "0");
      return true;
    } catch (err) {
      this.logger.warn(`Redis SCAN/DEL failed for pattern "${pattern}": ${(err as Error).message}`);
      return false;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
