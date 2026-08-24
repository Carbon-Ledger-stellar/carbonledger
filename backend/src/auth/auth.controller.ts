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
import { ChallengeDto, VerifyDto, RefreshDto, LogoutDto } from './auth.dto';
import { Public } from './decorators';

export const REFRESH_COOKIE = 'refresh_token';

/** 30 days — matches the TokenFamilyService hard TTL. */
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

    res.clearCookie(REFRESH_COOKIE, { path: '/auth' });
    return result;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private setRefreshCookie(res: Response, rawToken: string): void {
    res.cookie(REFRESH_COOKIE, rawToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/auth',
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
