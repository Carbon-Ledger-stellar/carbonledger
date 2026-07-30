import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ChallengeDto, VerifyDto, RefreshDto, LogoutDto } from './auth.dto';
import { Public } from './decorators';

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

  /** Step 2 — Submit signed challenge to receive JWT access token + opaque refresh token. */
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  verify(@Body() dto: VerifyDto) {
    return this.authService.verifySignatureAndLogin(
      dto.publicKey,
      dto.signature,
      dto.nonce,
      dto.role,
    );
  }

  /**
   * Step 3 — Exchange a valid refresh token for a new token pair.
   *
   * The old refresh token is invalidated immediately (rotation).
   * If the same token is presented twice, the entire family is
   * invalidated and re-login is required.
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  /**
   * Logout — invalidate the full refresh token family.
   *
   * Pass the current refresh token; every device sharing the same family
   * (i.e., this login session) is signed out.
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  logout(@Body() dto: LogoutDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
