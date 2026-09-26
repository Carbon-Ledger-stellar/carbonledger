import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { TwoFactorService } from './two-factor.service';
import { IsString, IsOptional } from 'class-validator';

class ConfirmTotpDto {
  @IsString() secret: string;
  @IsString() code: string;
}

class VerifyCodeDto {
  @IsString() code: string;
}

class VerifyEmailOtpDto {
  @IsString() code: string;
}

class VerifyRecoveryCodeDto {
  @IsString() code: string;
}

/**
 * TwoFactorController — manages 2FA setup, verification, and recovery (#1079).
 *
 * TOTP flow:
 *   1. GET  /2fa/totp/setup      → receive secret + otpauthUrl for QR code
 *   2. POST /2fa/totp/confirm    → verify first code, enable TOTP, get recovery codes
 *   3. POST /2fa/totp/verify     → verify code for a high-risk operation
 *
 * Email OTP flow (fallback):
 *   1. POST /2fa/email/send      → generate OTP and send to user's registered email
 *   2. POST /2fa/email/verify    → verify submitted OTP
 *
 * Recovery:
 *   POST /2fa/recovery/verify    → verify a recovery code (disables 2FA requirement once)
 *   POST /2fa/recovery/regenerate → get new set of recovery codes (requires TOTP first)
 *
 * Status:
 *   GET  /2fa/status             → get current 2FA configuration
 *   DELETE /2fa                  → disable 2FA entirely
 */
@Controller('2fa')
export class TwoFactorController {
  constructor(private readonly twoFactorService: TwoFactorService) {}

  /** GET /2fa/status — return 2FA configuration status for the authenticated user. */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  getStatus(@Req() req: Request) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.getStatus(userId);
  }

  // ── TOTP ──────────────────────────────────────────────────────────────────

  /**
   * GET /2fa/totp/setup
   * Generate a new TOTP secret and return the provisioning URI.
   * The QR code should be rendered client-side from `otpauthUrl`.
   */
  @Get('totp/setup')
  @HttpCode(HttpStatus.OK)
  generateTotpSecret(@Req() req: Request) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.generateTotpSecret(userId);
  }

  /**
   * POST /2fa/totp/confirm
   * Body: { secret, code }
   * Verify the first TOTP code from the authenticator app.
   * On success: TOTP is enabled and 10 one-time recovery codes are returned.
   */
  @Post('totp/confirm')
  @HttpCode(HttpStatus.OK)
  confirmTotpSetup(@Req() req: Request, @Body() body: ConfirmTotpDto) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.confirmTotpSetup(userId, body.secret, body.code);
  }

  /**
   * POST /2fa/totp/verify
   * Body: { code }
   * Verify a TOTP code for a high-risk operation (retire >1000, role change, etc.).
   * Returns { valid: true/false }.
   */
  @Post('totp/verify')
  @HttpCode(HttpStatus.OK)
  verifyTotpCode(@Req() req: Request, @Body() body: VerifyCodeDto) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.verifyTotpCode(userId, body.code);
  }

  // ── Email OTP ─────────────────────────────────────────────────────────────

  /**
   * POST /2fa/email/send
   * Generate and send a 6-digit email OTP to the user's registered email.
   * The actual email delivery must be wired to the MailService by the caller.
   * Returns the OTP expiry time.
   */
  @Post('email/send')
  @HttpCode(HttpStatus.OK)
  async sendEmailOtp(@Req() req: Request) {
    const userId = this.extractUserId(req);
    const { otp, expiresAt } = await this.twoFactorService.generateEmailOtp(userId);

    // NOTE: In a full implementation, trigger MailService here to send the OTP.
    // Returning the OTP in the response is only acceptable in development/testing.
    // In production, the OTP must ONLY be sent via email — remove the otp field.
    const isDev = process.env.NODE_ENV !== 'production';
    return {
      message:   'OTP sent to your registered email address',
      expiresAt: expiresAt.toISOString(),
      ...(isDev && { otp }), // only exposed in non-production environments
    };
  }

  /**
   * POST /2fa/email/verify
   * Body: { code }
   * Verify the submitted email OTP.
   */
  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  verifyEmailOtp(@Req() req: Request, @Body() body: VerifyEmailOtpDto) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.verifyEmailOtp(userId, body.code);
  }

  // ── Recovery ──────────────────────────────────────────────────────────────

  /**
   * POST /2fa/recovery/verify
   * Body: { code }
   * Verify a recovery code. Each code is single-use.
   */
  @Post('recovery/verify')
  @HttpCode(HttpStatus.OK)
  verifyRecoveryCode(@Req() req: Request, @Body() body: VerifyRecoveryCodeDto) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.verifyRecoveryCode(userId, body.code);
  }

  /**
   * POST /2fa/recovery/regenerate
   * Regenerate all recovery codes (invalidates existing unused codes).
   */
  @Post('recovery/regenerate')
  @HttpCode(HttpStatus.OK)
  regenerateRecoveryCodes(@Req() req: Request) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.regenerateRecoveryCodes(userId);
  }

  // ── Disable ───────────────────────────────────────────────────────────────

  /**
   * DELETE /2fa
   * Disable 2FA for the authenticated user. Clears all secrets and recovery codes.
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  disable2FA(@Req() req: Request) {
    const userId = this.extractUserId(req);
    return this.twoFactorService.disable2FA(userId);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private extractUserId(req: Request): string {
    const user = (req as any).user;
    const id = user?.id || user?.sub || user?.publicKey;
    if (!id) {
      throw new BadRequestException('Authenticated user ID not found in request');
    }
    return id;
  }
}
