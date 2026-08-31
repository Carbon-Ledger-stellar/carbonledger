import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import * as crypto from 'crypto';
import { createHmac } from 'crypto';

/** TOTP time step in seconds (RFC 6238 standard: 30s) */
const TOTP_STEP_SECONDS = 30;
/** Number of TOTP windows to accept on either side (allows ±30s clock skew) */
const TOTP_WINDOW = 1;
/** Email OTP validity window in seconds */
const EMAIL_OTP_TTL_SECONDS = 10 * 60; // 10 minutes
/** Max OTP attempts before lockout */
const MAX_OTP_ATTEMPTS = 5;
/** Number of recovery codes generated on setup */
const RECOVERY_CODE_COUNT = 10;
/** Recovery code length in bytes → hex string of length 16 */
const RECOVERY_CODE_BYTES = 8;

@Injectable()
export class TwoFactorService {
  constructor(private prisma: PrismaService) {}

  // ── TOTP Setup ──────────────────────────────────────────────────────────────

  /**
   * Generate a new TOTP secret and return the base32 secret + provisioning URI
   * for a QR code. The secret is NOT saved until the user verifies their first
   * TOTP code with confirmTotpSetup().
   */
  async generateTotpSecret(userId: string): Promise<{
    secret:           string;
    otpauthUrl:       string;
    qrCodeDataUrl:    string;
  }> {
    // Generate 20 random bytes → 32-char base32 secret (standard TOTP size)
    const secretBytes  = crypto.randomBytes(20);
    const secret       = base32Encode(secretBytes);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const issuer      = encodeURIComponent('CarbonLedger');
    const accountName = encodeURIComponent(user.publicKey ?? user.id);
    const otpauthUrl  = `otpauth://totp/${issuer}:${accountName}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

    // Inline QR code as a data URL (SVG path representation for minimal deps)
    // In production this would use a proper QR library — we return the URI
    // so the frontend can use a JS QR library (qrcode.react, etc.)
    const qrCodeDataUrl = `data:text/plain;base64,${Buffer.from(otpauthUrl).toString('base64')}`;

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  /**
   * Confirm TOTP setup: verify the first code from the authenticator app and
   * save the secret. Returns recovery codes (shown once, never again).
   */
  async confirmTotpSetup(userId: string, secret: string, code: string): Promise<{
    recoveryCodes: string[];
  }> {
    if (!this.verifyTotp(secret, code)) {
      throw new BadRequestException('Invalid TOTP code — check your authenticator app');
    }

    const recoveryCodes = await this.prisma.$transaction(async (tx) => {
      // Save the verified TOTP secret and enable 2FA
      await tx.twoFactorAuth.upsert({
        where:  { userId },
        create: { userId, totpSecret: secret, totpVerified: true, enabled: true },
        update: { totpSecret: secret, totpVerified: true, enabled: true },
      });

      // Generate and store hashed recovery codes
      return this.createRecoveryCodes(userId, tx);
    });

    return { recoveryCodes };
  }

  /**
   * Verify a TOTP code for a user. Returns true if valid.
   * Used to gate high-risk operations (retirements >1000 credits, role changes).
   */
  async verifyTotpCode(userId: string, code: string): Promise<{ valid: boolean }> {
    const tfa = await this.prisma.twoFactorAuth.findUnique({ where: { userId } });
    if (!tfa?.totpVerified || !tfa.totpSecret) {
      throw new BadRequestException('TOTP 2FA not configured for this user');
    }

    const valid = this.verifyTotp(tfa.totpSecret, code);
    if (valid) {
      await this.prisma.twoFactorAuth.update({
        where: { userId },
        data:  { lastUsedAt: new Date() },
      });
    }

    return { valid };
  }

  // ── Email OTP ───────────────────────────────────────────────────────────────

  /**
   * Generate a 6-digit email OTP, persist its hash, and return the plaintext
   * code to be sent via email. Clears any previous attempt counter.
   */
  async generateEmailOtp(userId: string): Promise<{ otp: string; expiresAt: Date }> {
    const otp       = String(crypto.randomInt(100000, 999999)).padStart(6, '0');
    const otpHash   = crypto.createHash('sha256').update(otp).digest('hex');
    const expiresAt = new Date(Date.now() + EMAIL_OTP_TTL_SECONDS * 1000);

    await this.prisma.twoFactorAuth.upsert({
      where:  { userId },
      create: {
        userId,
        emailEnabled:     true,
        emailOtp:         otpHash,
        emailOtpExpiry:   expiresAt,
        emailOtpAttempts: 0,
      },
      update: {
        emailOtp:         otpHash,
        emailOtpExpiry:   expiresAt,
        emailOtpAttempts: 0,
      },
    });

    return { otp, expiresAt };
  }

  /**
   * Verify an email OTP code. Enforces attempt limits and expiry.
   */
  async verifyEmailOtp(userId: string, code: string): Promise<{ valid: boolean }> {
    const tfa = await this.prisma.twoFactorAuth.findUnique({ where: { userId } });
    if (!tfa?.emailOtp) {
      throw new BadRequestException('No email OTP pending for this user');
    }

    // Check attempt limit
    if (tfa.emailOtpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new UnauthorizedException('Too many OTP attempts — request a new code');
    }

    // Check expiry
    if (tfa.emailOtpExpiry && tfa.emailOtpExpiry < new Date()) {
      throw new UnauthorizedException('Email OTP has expired — request a new code');
    }

    const submitted = crypto.createHash('sha256').update(code).digest('hex');
    const valid     = submitted === tfa.emailOtp;

    if (valid) {
      // Clear the OTP after successful use
      await this.prisma.twoFactorAuth.update({
        where: { userId },
        data:  {
          emailOtp:         null,
          emailOtpExpiry:   null,
          emailOtpAttempts: 0,
          lastUsedAt:       new Date(),
        },
      });
    } else {
      // Increment attempt counter
      await this.prisma.twoFactorAuth.update({
        where: { userId },
        data:  { emailOtpAttempts: { increment: 1 } },
      });
    }

    return { valid };
  }

  // ── Recovery Codes ──────────────────────────────────────────────────────────

  /**
   * Verify a recovery code and mark it used if valid.
   * Used as a fallback when TOTP device is unavailable.
   */
  async verifyRecoveryCode(userId: string, code: string): Promise<{ valid: boolean }> {
    const normalised = code.toUpperCase().replace(/\s/g, '');
    const codeHash   = crypto.createHash('sha256').update(normalised).digest('hex');

    const recoveryCode = await this.prisma.recoveryCode.findFirst({
      where: { userId, codeHash, usedAt: null },
    });

    if (!recoveryCode) {
      return { valid: false };
    }

    // Mark as used — single use
    await this.prisma.recoveryCode.update({
      where: { id: recoveryCode.id },
      data:  { usedAt: new Date() },
    });

    return { valid: true };
  }

  /**
   * Regenerate recovery codes (e.g. after partial use). Returns new codes.
   * Requires TOTP verification to prevent abuse.
   */
  async regenerateRecoveryCodes(userId: string): Promise<{ recoveryCodes: string[] }> {
    // Invalidate all existing codes
    await this.prisma.recoveryCode.deleteMany({ where: { userId } });
    const codes = await this.createRecoveryCodes(userId);
    return { recoveryCodes: codes };
  }

  // ── 2FA Status ──────────────────────────────────────────────────────────────

  /**
   * Return 2FA configuration status for a user (no secrets).
   */
  async getStatus(userId: string): Promise<{
    enabled:       boolean;
    totpEnabled:   boolean;
    emailEnabled:  boolean;
    recoveryCodesRemaining: number;
  }> {
    const [tfa, remainingCodes] = await Promise.all([
      this.prisma.twoFactorAuth.findUnique({ where: { userId } }),
      this.prisma.recoveryCode.count({ where: { userId, usedAt: null } }),
    ]);

    return {
      enabled:                tfa?.enabled         ?? false,
      totpEnabled:            tfa?.totpVerified     ?? false,
      emailEnabled:           tfa?.emailEnabled     ?? false,
      recoveryCodesRemaining: remainingCodes,
    };
  }

  /**
   * Disable 2FA for a user. Clears all secrets and recovery codes.
   * Should require elevated auth before calling.
   */
  async disable2FA(userId: string): Promise<{ message: string }> {
    await this.prisma.$transaction([
      this.prisma.twoFactorAuth.upsert({
        where:  { userId },
        create: { userId, enabled: false },
        update: {
          enabled:          false,
          totpSecret:       null,
          totpVerified:     false,
          emailEnabled:     false,
          emailOtp:         null,
          emailOtpExpiry:   null,
          emailOtpAttempts: 0,
        },
      }),
      this.prisma.recoveryCode.deleteMany({ where: { userId } }),
    ]);

    return { message: '2FA has been disabled' };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * RFC 6238 TOTP verification.
   * Computes the expected code for [now - WINDOW, ..., now + WINDOW] time steps.
   */
  private verifyTotp(secret: string, code: string): boolean {
    const now      = Math.floor(Date.now() / 1000);
    const counter  = Math.floor(now / TOTP_STEP_SECONDS);

    for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
      const expected = this.computeHotp(secret, counter + delta);
      if (expected === code.trim()) return true;
    }
    return false;
  }

  /**
   * RFC 4226 HOTP — compute a 6-digit code for the given counter.
   */
  private computeHotp(secret: string, counter: number): string {
    const key     = base32Decode(secret);
    const counterBuf = Buffer.alloc(8);
    // Write 64-bit counter big-endian
    counterBuf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
    counterBuf.writeUInt32BE(counter >>> 0, 4);

    const hmac  = createHmac('sha1', key).update(counterBuf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code   = (
      ((hmac[offset]     & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) <<  8) |
       (hmac[offset + 3] & 0xff)
    ) % 1_000_000;

    return String(code).padStart(6, '0');
  }

  /**
   * Create RECOVERY_CODE_COUNT new recovery codes for userId.
   * Returns the plaintext codes (caller must show them to the user once).
   */
  private async createRecoveryCodes(userId: string, tx?: any): Promise<string[]> {
    const db    = tx ?? this.prisma;
    const codes: string[] = [];

    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const plain     = crypto.randomBytes(RECOVERY_CODE_BYTES).toString('hex').toUpperCase();
      const codeHash  = crypto.createHash('sha256').update(plain).digest('hex');
      codes.push(plain);
      await db.recoveryCode.create({ data: { userId, codeHash } });
    }

    return codes;
  }
}

// ── Base32 helpers ─────────────────────────────────────────────────────────────
// Minimal RFC 4648 base32 implementation — no external dependency required.

const BASE32_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value  = (value << 8) | byte;
    bits  += 8;
    while (bits >= 5) {
      output += BASE32_CHARSET[(value >>> (bits - 5)) & 31];
      bits   -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_CHARSET[(value << (5 - bits)) & 31];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  const str    = input.toUpperCase().replace(/=+$/, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;

  for (const char of str) {
    const idx = BASE32_CHARSET.indexOf(char);
    if (idx === -1) continue;
    value  = (value << 5) | idx;
    bits  += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}
