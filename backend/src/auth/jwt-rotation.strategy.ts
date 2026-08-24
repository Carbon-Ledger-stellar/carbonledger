import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { verify } from 'jsonwebtoken';
import { SecretsRefreshService } from '../key-rotation/secrets-refresh.service';
import { TokenBlacklistService } from './token-blacklist.service';

/**
 * Previously read JWT_SECRET / JWT_SECRET_NEW directly from ConfigService,
 * which meant the "old secret stays valid" window was open-ended (as long
 * as JWT_SECRET_NEW was set) and required an env change + restart to
 * actually rotate. Now reads from SecretsRefreshService, which is kept
 * current by the rotate-jwt-secret Lambda (infra/main/secrets.tf) without
 * a restart, and the old secret only verifies for the 15-minute overlap
 * window baked into the secret document itself.
 */
@Injectable()
export class JWTRotationStrategy extends PassportStrategy(Strategy, 'jwt-rotation') {
  constructor(
    private readonly configService: ConfigService,
    private readonly secretsRefresh: SecretsRefreshService,
    private readonly tokenBlacklist: TokenBlacklistService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (request, rawJwtToken, done) => {
        const issuer = configService.get<string>('JWT_ISSUER') || 'carbonledger';
        const candidates = this.secretsRefresh.getJwtVerificationSecrets();

        for (const secret of candidates) {
          try {
            // Just probe whether this candidate verifies — don't use the
            // decoded result here. secretOrKeyProvider's `done` callback
            // must receive the SECRET itself (string | Buffer), not the
            // decoded payload; passport-jwt re-verifies internally using
            // whatever we hand back below.
            verify(rawJwtToken, secret, { issuer });
            return done(null, secret);
          } catch {
            // try the next candidate (covers the rotation overlap window)
          }
        }
        return done(new Error('Invalid or expired token'), null);
      },
    });
  }

  async validate(payload: { sub: string; role: string; type?: string; jti?: string }) {
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    if (payload.jti && (await this.tokenBlacklist.isRevoked(payload.jti))) {
      throw new UnauthorizedException('Token has been revoked');
    }
    return { publicKey: payload.sub, role: payload.role };
  }
}
