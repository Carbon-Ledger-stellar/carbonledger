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
  ) {}

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
        create: { publicKey, role },
      });
      return this.issueTokenPair(user.publicKey, user.role as UserRole);
    } catch (error: any) {
      if (error?.code === 'P2024') {
        throw new ServiceUnavailableException('Service temporarily unavailable — please retry');
      }
      throw error;
    }
  }

  /** Rotate refresh token. */
  async refresh(
    refreshToken: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    let payload: { sub: string; role: string; type: string };
    try {
      payload = this.jwt.verify(refreshToken, {
        secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev-refresh-secret',
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('Not a refresh token');
    }

    try {
      const user = await this.prisma.user.findUnique({ where: { publicKey: payload.sub } });
      if (!user) throw new UnauthorizedException('User not found');
      return this.issueTokenPair(user.publicKey, user.role as UserRole);
    } catch (error: any) {
      if (error?.code === 'P2024') {
        throw new ServiceUnavailableException('Service temporarily unavailable — please retry');
      }
      throw error;
    }
  }

  async validateUser(publicKey: string): Promise<{ publicKey: string; role: string } | null> {
    const user = await this.prisma.user.findUnique({ where: { publicKey } });
    return user ? { publicKey: user.publicKey, role: user.role } : null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private issueTokenPair(
    publicKey: string,
    role: UserRole,
  ): { access_token: string; refresh_token: string } {
    const access_token = this.jwt.sign(
      { sub: publicKey, role, type: 'access' },
      {
        secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
        expiresIn: process.env.JWT_EXPIRY || '15m',
      },
    );
    const refresh_token = this.jwt.sign(
      { sub: publicKey, role, type: 'refresh' },
      {
        secret: process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'dev-refresh-secret',
        expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d',
      },
    );
    return { access_token, refresh_token };
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
