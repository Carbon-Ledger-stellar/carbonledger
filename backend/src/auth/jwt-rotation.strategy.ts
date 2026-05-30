import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JWTRotationStrategy extends PassportStrategy(Strategy, 'jwt-rotation') {
  constructor(private readonly configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      // Support both old and new secrets during rotation
      secretOrKeyProvider: async (request, rawJwtToken, done) => {
        const primarySecret = configService.get<string>('JWT_SECRET') || 'dev-secret-change-in-production';
        const secondarySecret = configService.get<string>('JWT_SECRET_NEW');
        
        // Try primary secret first
        try {
          const decoded = require('jsonwebtoken').verify(rawJwtToken, primarySecret);
          return done(null, decoded);
        } catch (primaryError) {
          // Try secondary secret if it exists
          if (secondarySecret) {
            try {
              const decoded = require('jsonwebtoken').verify(rawJwtToken, secondarySecret);
              return done(null, decoded);
            } catch (secondaryError) {
              return done(secondaryError, null);
            }
          }
          return done(primaryError, null);
        }
      },
    });
  }

  async validate(payload: { sub: string; role: string }) {
    return { publicKey: payload.sub, role: payload.role };
  }
}
