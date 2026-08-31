import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { verify } from 'jsonwebtoken';
import { SecretsRefreshService } from '../key-rotation/secrets-refresh.service';

/**
 * Previously verified against a single static process.env.JWT_SECRET,
 * which meant a rotation required this process to restart before it
 * would accept newly-issued tokens (and would reject in-flight ones
 * signed moments before the rotation). Now tries every currently-valid
 * secret from SecretsRefreshService — current, plus previous while still
 * inside its 15-minute overlap window — same as JWTRotationStrategy.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly secretsRefresh: SecretsRefreshService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKeyProvider: (_request, rawJwtToken, done) => {
        const issuer = process.env.JWT_ISSUER || 'carbonledger';
        const candidates = this.secretsRefresh.getJwtVerificationSecrets();

        for (const secret of candidates) {
          try {
            verify(rawJwtToken, secret, { issuer });
            return done(null, secret); // passport-jwt re-verifies with the secret we return
          } catch {
            // try the next candidate (covers the rotation overlap window)
          }
        }
        return done(new Error('Invalid or expired token'), null);
      },
    });
  }

  async validate(payload: { sub: string; role: string; type: string; jti?: string }) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    if (payload.jti && (await this.tokenBlacklist.isRevoked(payload.jti))) {
      throw new UnauthorizedException('Token has been revoked');
    }
    return { publicKey: payload.sub, role: payload.role };
  }
}
