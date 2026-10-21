import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChallengeDto, VerifyDto, RefreshDto, LogoutDto, WalletNonceDto, WalletLoginDto } from './auth.dto';
import { Public } from './decorators';

export const REFRESH_COOKIE = 'refresh_token';

/** 30 days — matches the TokenFamilyService hard TTL. */
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Must match how this controller is actually mounted: main.ts sets
 * `setGlobalPrefix('api')` plus URI versioning (`prefix: 'v'`,
 * `defaultVersion: '1'`), so `@Controller('auth')` is served at
 * `/api/v1/auth/*` — not `/auth/*`. A cookie scoped to the wrong Path is
 * simply never sent back by the browser, which silently breaks the
 * refresh flow entirely (verified: a client that calls /api/v1/auth/verify
 * then /api/v1/auth/refresh never gets the cookie and refresh 401s).
 */
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
@Public()
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /** Step 1 — Request a challenge nonce to sign with Freighter. */
  @Get('challenge')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  challenge(@Query() dto: ChallengeDto) {
    return this.authService.generateChallenge(dto.publicKey);
  }

  // ── Wallet-login (issue #1023) ─────────────────────────────────────────────

  /**
   * Step 1 — Request a server-generated nonce bound to a Freighter wallet
   * public key.  The nonce is stored in Redis with a 5-minute TTL and is
   * single-use: presenting it in POST /auth/wallet-login invalidates it
   * immediately regardless of whether verification succeeds.
   *
   * Rate-limited to 10 requests per minute per IP to prevent nonce flooding.
   */
  @Get('wallet-nonce')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  walletNonce(@Query() dto: WalletNonceDto) {
    return this.authService.generateWalletNonce(dto.publicKey);
  }

  /**
   * Step 2 — Submit a Freighter wallet signature over the server nonce to
   * receive a short-lived JWT access token and an opaque refresh token.
   *
   * The client must sign the exact UTF-8 string `carbonledger-wallet:<nonce>`
   * with their Ed25519 Stellar keypair and encode the resulting signature as
   * lowercase hex.
   *
   * On success:
   *  - `access_token`  — signed JWT (15-minute TTL) in the response body.
   *  - `refresh_token` — opaque token delivered exclusively as an HTTP-only
   *    cookie (never exposed to JavaScript), consistent with the existing
   *    /auth/verify flow (#892).
   *
   * Rate-limited to 5 requests per minute per IP to resist brute-force.
   */
  @Post('wallet-login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async walletLogin(
    @Body() dto: WalletLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { access_token, refresh_token } = await this.authService.walletLogin(
      dto.publicKey,
      dto.signature,
      dto.nonce,
    );

    this.setRefreshCookie(res, refresh_token);
    return { access_token };
  }

  /**
   * Step 2 — Submit signed challenge to receive JWT access token + opaque
   * refresh token.
   *
   * The refresh token is delivered ONLY inside an HTTP-only cookie so that
   * browser-based clients can never leak it to JavaScript (#892).
   */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async verify(@Body() dto: VerifyDto, @Res({ passthrough: true }) res: Response) {
    const { access_token, refresh_token } = await this.authService.verifySignatureAndLogin(
      dto.publicKey,
      dto.signature,
      dto.nonce,
      dto.role,
    );

    this.setRefreshCookie(res, refresh_token);
    // Body keeps the access token only; the refresh token travels via cookie.
    return { access_token };
  }

  /**
   * Step 3 — Exchange a valid refresh token for a new token pair.
   *
   * The refresh token is read from the HTTP-only cookie (body accepted as a
   * fallback for non-cookie API clients). Rotation is atomic: the old token
   * is invalidated immediately and a fresh one is set on the response cookie.
   * Presenting the same token twice trips reuse detection and invalidates
   * the entire family.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: RefreshDto,
  ) {
    const refreshToken = this.extractRefreshToken(req, dto.refreshToken);
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token missing');
    }

    const { access_token, refresh_token } = await this.authService.refresh(refreshToken);

    this.setRefreshCookie(res, refresh_token);
    return { access_token };
  }

  /**
   * Logout — blacklist the current ACCESS token's `jti` in Redis (route
   * guards reject it from this moment on) and invalidate the full refresh
   * token family, then clear the cookie.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LogoutDto,
  ) {
    const refreshToken = this.extractRefreshToken(req, dto.refreshToken);
    const accessToken = this.extractBearerToken(req);

    const result = await this.authService.logout(refreshToken ?? '', accessToken ?? undefined);

    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return result;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, rawToken: string): void {
    res.cookie(REFRESH_COOKIE, rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });
  }

  private extractRefreshToken(req: Request, bodyToken?: string): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    return cookies?.[REFRESH_COOKIE] || bodyToken || undefined;
  }

  private extractBearerToken(req: Request): string | null {
    const auth: string = req.headers?.authorization ?? '';
    return auth.startsWith('Bearer ') ? auth.slice(7) : null;
  }
}
