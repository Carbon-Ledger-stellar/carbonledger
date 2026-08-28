import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as crypto from 'crypto';
import { RedisService } from '../redis.service';

/**
 * Shape stored in Redis under key `auth:family:{familyId}`.
 *
 * All refresh token values stored here are HMAC-SHA256 hashes — never plaintext.
 */
export interface TokenFamily {
  /** Stellar public key of the owning user. */
  userId: string;
  /**
   * Hashes of every refresh token ever issued in this family, oldest first.
   * Once rotated, previous hashes are retained to enable reuse detection.
   */
  tokens: string[];
  /** Hash of the one currently-valid refresh token (tail of the chain). */
  activeTokenHash: string;
  /** Unix milliseconds — set at family creation. */
  createdAt: number;
  /** Unix milliseconds — updated on every successful rotation. */
  lastUsedAt: number;
}

// ── TTL constants ────────────────────────────────────────────────────────────
const FAMILY_HARD_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const FAMILY_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;  // 7-day idle eviction

const REDIS_KEY_PREFIX = 'auth:family:';

/** UUID v4 pattern used to validate the familyId segment inside a raw token. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

@Injectable()
export class TokenFamilyService {
  private readonly logger = new Logger(TokenFamilyService.name);

  constructor(private readonly redis: RedisService) {}

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Create a brand-new token family at login.
   *
   * The raw token format is `<familyId>.<random-bytes-base64url>`.
   * Embedding the familyId allows O(1) Redis lookup on every refresh —
   * no secondary index required.
   */
  async createFamily(userId: string): Promise<{ familyId: string; rawToken: string }> {
    const familyId = crypto.randomUUID();
    const rawToken = this.buildRawToken(familyId);
    const hash = this.hashToken(rawToken);

    const family: TokenFamily = {
      userId,
      tokens: [hash],
      activeTokenHash: hash,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    await this.persistFamily(familyId, family);
    this.logger.debug(`Token family created: ${familyId} for user ${userId}`);
    return { familyId, rawToken };
  }

  /**
   * Rotate a refresh token.
   *
   * Decision tree:
   *  1. Family missing  → expired / already invalidated → reject.
   *  2. Hash matches `activeTokenHash` → rotate (issue new token, retire old).
   *  3. Hash exists in `tokens` but is NOT active → reuse detected → invalidate entire family.
   *  4. Hash not in `tokens` at all → not from this family → reject.
   */
  async rotateToken(rawToken: string): Promise<{ newRawToken: string; userId: string }> {
    const familyId = this.extractFamilyId(rawToken);
    if (!familyId) {
      throw new UnauthorizedException('Invalid refresh token format');
    }

    const family = await this.loadFamily(familyId);
    if (!family) {
      throw new UnauthorizedException('Refresh token expired or already invalidated');
    }

    const incomingHash = this.hashToken(rawToken);

    if (family.tokens.includes(incomingHash) && incomingHash !== family.activeTokenHash) {
      // Reuse of a previously-rotated token → compromise signal
      this.logger.warn(
        `Reuse detected in family ${familyId} (user: ${family.userId}) — invalidating entire family`,
      );
      await this.invalidateFamily(familyId);
      throw new UnauthorizedException(
        'Refresh token reuse detected — all sessions have been invalidated. Please log in again.',
      );
    }

    if (incomingHash !== family.activeTokenHash) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Happy path: rotate
    const newRawToken = this.buildRawToken(familyId);
    const newHash = this.hashToken(newRawToken);

    family.tokens.push(newHash);
    family.activeTokenHash = newHash;
    family.lastUsedAt = Date.now();

    await this.persistFamily(familyId, family);
    this.logger.debug(`Token rotated in family ${familyId}`);
    return { newRawToken, userId: family.userId };
  }

  /**
   * Invalidate the full token family associated with `rawToken`.
   * Used by the logout endpoint.
   */
  async invalidateFamilyByToken(rawToken: string): Promise<void> {
    const familyId = this.extractFamilyId(rawToken);
    if (!familyId) return; // malformed — nothing to do
    await this.invalidateFamily(familyId);
    this.logger.debug(`Family ${familyId} invalidated via logout`);
  }

  /**
   * Directly delete a family by its ID.
   * Exposed for admin-forced logout and reuse-detection invalidation.
   */
  async invalidateFamily(familyId: string): Promise<void> {
    await this.redis.del(`${REDIS_KEY_PREFIX}${familyId}`);
  }

  // ── Hashing ──────────────────────────────────────────────────────────────

  /**
   * HMAC-SHA256 of the raw token using `HMAC_SECRET` (falls back to `JWT_SECRET`).
   * Public so that tests can hash tokens produced in tests.
   */
  hashToken(rawToken: string): string {
    const secret =
      process.env.HMAC_SECRET ||
      process.env.JWT_SECRET ||
      'dev-hmac-secret-change-in-production';
    return crypto.createHmac('sha256', secret).update(rawToken).digest('hex');
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Build a raw opaque refresh token: `<familyId>.<32-random-bytes-base64url>`. */
  private buildRawToken(familyId: string): string {
    const entropy = crypto.randomBytes(32).toString('base64url');
    return `${familyId}.${entropy}`;
  }

  /**
   * Extract the familyId (UUID v4) from the token's first segment.
   * Returns null when the format is unrecognisable.
   */
  private extractFamilyId(rawToken: string): string | null {
    if (!rawToken || !rawToken.includes('.')) return null;
    const candidate = rawToken.split('.')[0];
    return UUID_RE.test(candidate) ? candidate : null;
  }

  private async loadFamily(familyId: string): Promise<TokenFamily | null> {
    return this.redis.get<TokenFamily>(`${REDIS_KEY_PREFIX}${familyId}`);
  }

  /**
   * Persist the family with a TTL that is the minimum of:
   *   - 7-day idle window  (refreshed on every write → idle families expire naturally)
   *   - remaining time until the 30-day hard cap
   *
   * This means an active family can live up to 30 days; an idle one expires
   * after 7 days of inactivity.
   */
  private async persistFamily(familyId: string, family: TokenFamily): Promise<void> {
    const ageSeconds = Math.floor((Date.now() - family.createdAt) / 1000);
    const remainingHardTtl = FAMILY_HARD_TTL_SECONDS - ageSeconds;
    const ttl = Math.min(FAMILY_IDLE_TTL_SECONDS, Math.max(remainingHardTtl, 1));

    await this.redis.set(`${REDIS_KEY_PREFIX}${familyId}`, family, ttl);
  }
}
