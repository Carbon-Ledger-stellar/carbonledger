import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;
  private connected = false;

  onModuleInit() {
    const url = process.env.REDIS_URL || "redis://redis:6379";
    this.client = new Redis(url, {
      // Do not throw on connection failure — fallback to DB instead
      enableOfflineQueue:   false,
      lazyConnect:          true,
      retryStrategy: (times) => {
        if (times > 3) {
          this.connected = false;
          return null; // stop retrying, surface error once
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.client.on("connect",   () => { this.connected = true;  this.logger.log("Redis connected"); });
    this.client.on("error",     (err) => { this.connected = false; this.logger.warn(`Redis error: ${err.message}`); });
    this.client.on("close",     () => { this.connected = false; });

    this.client.connect().catch((err) => {
      this.logger.warn(`Redis initial connection failed — caching disabled: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => null);
  }

  /** Retrieve a cached value. Returns null on miss or Redis unavailability. */
  async get<T>(key: string): Promise<T | null> {
    if (!this.connected) return null;
    try {
      const raw = await this.client.get(key);
      if (raw === null) {
        this.logger.debug(`Cache MISS — key: ${key}`);
        return null;
      }
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.warn(`Redis GET failed for key "${key}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Store a value with an optional TTL in seconds (default 300 = 5 minutes). */
  async set(key: string, value: unknown, ttlSeconds = 300): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      this.logger.warn(`Redis SET failed for key "${key}": ${(err as Error).message}`);
    }
  }

  /** Delete one or more keys by exact name. */
  async del(...keys: string[]): Promise<void> {
    if (!this.connected || keys.length === 0) return;
    try {
      await this.client.del(...keys);
    } catch (err) {
      this.logger.warn(`Redis DEL failed for keys [${keys.join(", ")}]: ${(err as Error).message}`);
    }
  }

  /**
   * Delete all keys matching a glob pattern (e.g. "projects:list:*").
   * Uses SCAN to avoid blocking the server.
   */
  async delPattern(pattern: string): Promise<void> {
    if (!this.connected) return;
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, "MATCH", pattern, "COUNT", 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
          this.logger.debug(`Invalidated ${keys.length} keys matching pattern "${pattern}"`);
        }
      } while (cursor !== "0");
    } catch (err) {
      this.logger.warn(`Redis SCAN/DEL failed for pattern "${pattern}": ${(err as Error).message}`);
    }
  }
}
