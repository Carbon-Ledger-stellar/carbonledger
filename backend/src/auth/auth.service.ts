import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import * as StellarSdk from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { TokenFamilyService } from './token-family.service';
import { SecretsRefreshService } from '../key-rotation/secrets-refresh.service';

export type UserRole = 'project_developer' | 'corporation' | 'verifier' | 'admin';

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

    // 1. Validate nonce
    const stored = nonceStore.get(publicKey);
    if (!stored || stored.nonce !== nonce) {
      throw new UnauthorizedException('Invalid or expired challenge');
    }
    if (Date.now() > stored.expiresAt) {
      nonceStore.delete(publicKey);
      throw new UnauthorizedException('Challenge expired');
    }
    nonceStore.delete(publicKey); // single-use

    // 2. Verify signature
    const message = `carbonledger:${nonce}`;
    if (!this.verifySignature(publicKey, message, signature)) {
      throw new UnauthorizedException('Signature verification failed');
    }

    // 3. Upsert user — role only applied on first creation
    try {
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

      const user = await this.prisma.user.findUnique({ where: { publicKey: userId } });
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
   * Logout — invalidate the full token family so every device using the
   * same refresh token chain is signed out immediately.
   */
  async logout(refreshToken: string): Promise<{ message: string }> {
    await this.tokenFamily.invalidateFamilyByToken(refreshToken);
    return { message: 'Logged out successfully' };
  }

  async validateUser(publicKey: string): Promise<{ publicKey: string; role: string } | null> {
    const user = await this.prisma.user.findUnique({ where: { publicKey } });
    return user ? { publicKey: user.publicKey, role: user.role } : null;
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
    const expiresIn = (process.env.JWT_EXPIRY || '15m') as jwt.SignOptions['expiresIn'];

    return jwt.sign(
      { sub: publicKey, role, type: 'access' },
      this.secretsRefresh.getJwtSigningSecret(),
      { expiresIn, issuer },
    );
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
