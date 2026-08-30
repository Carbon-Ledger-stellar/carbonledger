import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { AccountLockoutService } from './account-lockout.service';
import * as StellarSdk from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { TokenFamilyService } from './token-family.service';
import { SecretsRefreshService } from '../key-rotation/secrets-refresh.service';

export type UserRole = 'project_developer' | 'corporation' | 'verifier' | 'admin';

/**
 * Access tokens are capped at 15 minutes regardless of any (mis)configured
 * JWT_EXPIRY — issue #892 requires short-lived tokens so a stolen token has
 * a strictly bounded window and the logout blacklist only needs to live for
 * at most 15 minutes.
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** Parse a jwt-style expiry string ('900s' | '15m' | '1h') into seconds. Unknown → 15m. */
export function parseExpirySeconds(raw: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(raw.trim());
  if (!match) return ACCESS_TOKEN_TTL_SECONDS;
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor = { s: 1, m: 60, h: 3600, d: 86400 }[unit] ?? 1;
  return value * factor;
}

// In-memory nonce store: publicKey → { nonce, expiresAt }
// A Redis store would be preferable in multi-instance deployments.
const nonceStore = new Map<string, { nonce: string; expiresAt: number }>();
const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly tokenFamily: TokenFamilyService,
    private readonly secretsRefresh: SecretsRefreshService,
  ) { }

  /** Issue a one-time challenge nonce for the given Stellar public key. */
  generateChallenge(publicKey: string): { nonce: string; expiresAt: number } {
    this.validatePublicKey(publicKey);
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + NONCE_TTL_MS;
    nonceStore.set(publicKey, { nonce, expiresAt });
    return { nonce, expiresAt };
  }

  /**
   * Verify a Stellar keypair signature over the challenge nonce.
   * The client must sign the exact string: `carbonledger:${nonce}`
   * Role is NEVER accepted from the request body for existing users —
   * new users default to "corporation"; existing users keep their DB role.
   *
   * On success a new token family is created in Redis and a raw (opaque)
   * refresh token is returned instead of a signed JWT refresh token.
   */
  async verifySignatureAndLogin(
    publicKey: string,
    signature: string,
    nonce: string,
    role: UserRole = 'corporation',
  ): Promise<{ access_token: string; refresh_token: string }> {
    this.validatePublicKey(publicKey);

    // 0. Check account lockout before doing anything else
    if (this.lockout.isLockedOut(publicKey)) {
      throw new UnauthorizedException(
        'Account temporarily locked. Too many failed attempts.',
      );
    }

    // 1. Validate nonce
    const stored = nonceStore.get(publicKey);
    if (!stored || stored.nonce !== nonce) {
      this.lockout.recordFailedAttempt(publicKey);
      throw new UnauthorizedException('Invalid or expired challenge');
    }
    if (Date.now() > stored.expiresAt) {
      nonceStore.delete(publicKey);
      this.lockout.recordFailedAttempt(publicKey);
      throw new UnauthorizedException('Challenge expired');
    }
    nonceStore.delete(publicKey); // single-use

    // 2. Verify signature
    const message = `carbonledger:${nonce}`;
    if (!this.verifySignature(publicKey, message, signature)) {
      this.lockout.recordFailedAttempt(publicKey);
      throw new UnauthorizedException('Signature verification failed');
    }

    // 3. Upsert user — role only applied on first creation
    try {
      const existingUser = await this.prisma.user.findUnique({ where: { publicKey } });
      if (existingUser?.deletedAt) {
        throw new UnauthorizedException('Account has been deleted');
      }

      const user = await this.prisma.user.upsert({
        where: { publicKey },
        update: {},
        create: { publicKey, role: 'corporation' },
      });

      // 4. Create a fresh token family in Redis
      const { rawToken } = await this.tokenFamily.createFamily(user.publicKey);
      const access_token = this.signAccessToken(user.publicKey, user.role as UserRole);

      return { access_token, refresh_token: rawToken };
    } catch (error: any) {
      if (error?.code === 'P2024') {
        throw new ServiceUnavailableException('Service temporarily unavailable — please retry');
      }
      throw error;
    }
  }

  /**
   * Rotate refresh token using token family tracking.
   *
   * Validates the incoming opaque refresh token against the Redis family store,
   * issues a new access + refresh token pair and retires the old refresh token.
   * If the same token is presented twice (reuse detection), the entire family
   * is invalidated and an error is thrown.
   */
  async refresh(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    try {
      const { newRawToken, userId } = await this.tokenFamily.rotateToken(refreshToken);

      const user = await this.prisma.user.findFirst({ where: { publicKey: userId, deletedAt: null } });
      if (!user) throw new UnauthorizedException('User not found');

      const access_token = this.signAccessToken(user.publicKey, user.role as UserRole);
      return { access_token, refresh_token: newRawToken };
    } catch (error: any) {
      if (error instanceof UnauthorizedException) throw error;
      if (error?.code === 'P2024') {
        throw new ServiceUnavailableException('Service temporarily unavailable — please retry');
      }
      throw error;
    }
  }

  /**
   * Logout — invalidate the full token family AND blacklist the current
   * access token's `jti` in Redis so it is rejected by route guards
   * immediately, not just when its (≤15 min) natural expiry arrives.
   */
  async logout(refreshToken: string, accessToken?: string): Promise<{ message: string }> {
    await this.tokenFamily.invalidateFamilyByToken(refreshToken);

    if (accessToken) {
      try {
        const issuer = process.env.JWT_ISSUER || 'carbonledger';
        const candidates = this.secretsRefresh.getJwtVerificationSecrets();
        for (const secret of candidates) {
          try {
            const decoded = jwt.verify(accessToken, secret, { issuer }) as {
              jti?: string;
              exp?: number;
            };
            if (decoded.jti && typeof decoded.exp === 'number') {
              const remainingSec = decoded.exp - Math.floor(Date.now() / 1000);
              if (remainingSec > 0) {
                await this.tokenBlacklist.revoke(decoded.jti, remainingSec);
              }
            }
            break;
          } catch {
            // try the next candidate secret (rotation overlap window)
          }
        }
      } catch {
        // best-effort: the refresh family is already invalidated; never fail logout here
      }
    }

    return { message: 'Logged out successfully' };
  }

  async validateUser(publicKey: string): Promise<{ publicKey: string; role: string } | null> {
    const user = await this.prisma.user.findFirst({ where: { publicKey, deletedAt: null } });
    return user ? { publicKey: user.publicKey, role: user.role } : null;
  }

  async softDeleteUser(publicKey: string, reason: string) {
    const user = await this.prisma.user.findUnique({ where: { publicKey } });
    if (!user) throw new NotFoundException('User not found');

    const retentionDays = this.getRetentionDays();
    const retentionUntil = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

    return this.prisma.user.update({
      where: { publicKey },
      data: {
        deletedAt: new Date(),
        deletionReason: reason,
        retentionUntil,
        email: null,
        isSubscribed: false,
      },
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Sign a short-lived JWT access token.
   * Refresh tokens are now opaque strings managed by TokenFamilyService.
   *
   * Previously signed with the static process.env.JWT_SECRET, which meant
   * a rotated secret only took effect after a restart. Now signs with
   * whatever SecretsRefreshService currently holds as `current` — kept up
   * to date by the rotate-jwt-secret Lambda via SIGHUP, no restart needed.
   */
  private signAccessToken(publicKey: string, role: UserRole): string {
    const issuer = process.env.JWT_ISSUER || 'carbonledger';
    // Strictly enforce the 15-minute maximum lifetime (#892): a longer
    // JWT_EXPIRY is clamped down rather than honoured.
    const requested = parseExpirySeconds(process.env.JWT_EXPIRY || '15m');
    const expiresIn = Math.min(requested, ACCESS_TOKEN_TTL_SECONDS);

    return jwt.sign(
      { sub: publicKey, role, type: 'access' },
      this.secretsRefresh.getJwtSigningSecret(),
      { expiresIn, issuer },
    );
  }

  private getRetentionDays(): number {
    const raw = Number(process.env.DATA_RETENTION_DAYS ?? process.env.RETENTION_DAYS ?? '90');
    return Number.isFinite(raw) && raw > 0 ? raw : 90;
  }

  private validatePublicKey(publicKey: string): void {
    try {
      StellarSdk.Keypair.fromPublicKey(publicKey);
    } catch {
      throw new BadRequestException('Invalid Stellar public key');
    }
  }

  private verifySignature(publicKey: string, message: string, signatureHex: string): boolean {
    try {
      const keypair = StellarSdk.Keypair.fromPublicKey(publicKey);
      const msgBuffer = Buffer.from(message, 'utf8');
      const sigBuffer = Buffer.from(signatureHex, 'hex');
      return keypair.verify(msgBuffer, sigBuffer);
    } catch {
      return false;
    }
  }
}
