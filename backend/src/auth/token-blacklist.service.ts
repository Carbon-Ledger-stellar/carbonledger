import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis.service';

/**
 * Redis-backed revocation blacklist for JWT access tokens.
 *
 * Every access token carries a unique `jti` claim. Logging out stores that
 * `jti` in Redis with a TTL equal to the token's remaining lifetime, so the
 * entry self-cleans exactly when the token would have expired anyway.
 *
 * Route guards (RolesGuard / JwtStrategy) consult this blacklist on every
 * authenticated request, which is what makes logout take effect immediately
 * instead of whenever the (previously long-lived) token happened to expire.
 *
 * Degraded mode: if Redis is unavailable, RedisService returns null/false and
 * `isRevoked` reports "not revoked". A stolen token then stays usable until
 * its natural expiry — bounded by the strict 15-minute access-token TTL.
 */
export const BLACKLIST_KEY_PREFIX = 'auth:bl:';

/** Hard upper bound for how long a blacklist entry is kept (15 minutes). */
export const MAX_BLACKLIST_TTL_SECONDS = 15 * 60;

@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Blacklist a token identity until it expires.
   *
   * @param jti           Unique token id from the JWT payload
   * @param remainingSec  Seconds until the token expires naturally; values are
   *                      clamped to (0, MAX_BLACKLIST_TTL_SECONDS]
   */
  async revoke(jti: string, remainingSec: number): Promise<boolean> {
    const ttl = Math.floor(Math.min(Math.max(remainingSec, 1), MAX_BLACKLIST_TTL_SECONDS));
    const ok = await this.redis.set(`${BLACKLIST_KEY_PREFIX}${jti}`, true, ttl);
    if (!ok) {
      this.logger.warn(
        `Failed to blacklist token ${jti} (Redis unavailable?) — it remains valid until natural expiry`,
      );
    }
    return ok;
  }

  /** True when the given token id has been revoked and has not yet expired. */
  async isRevoked(jti: string): Promise<boolean> {
    const value = await this.redis.get<boolean>(`${BLACKLIST_KEY_PREFIX}${jti}`);
    return value === true;
  }
}
