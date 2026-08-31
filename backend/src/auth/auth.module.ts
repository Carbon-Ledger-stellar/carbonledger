import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JWTRotationStrategy } from './jwt-rotation.strategy';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { AccountLockoutService } from './account-lockout.service';
import { RolesGuard } from './roles.guard';
import { TokenFamilyService } from './token-family.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { PrismaService } from '../prisma.service';
import { KeyRotationModule } from '../key-rotation/key-rotation.module';

@Module({
  imports: [
    PassportModule,
    // Kept for any other place JwtService might be injected — actual
    // signing now happens in AuthService via SecretsRefreshService, not
    // this static secret, so this config is effectively a harmless
    // fallback rather than the source of truth.
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
      signOptions: {
        expiresIn: process.env.JWT_EXPIRY || '15m' as any,
        issuer: process.env.JWT_ISSUER || 'carbonledger',
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]),
    KeyRotationModule, // provides SecretsRefreshService
  ],
  providers: [
    AuthService,
    TokenFamilyService,
    TokenBlacklistService,
    JwtStrategy,
    JWTRotationStrategy,
    LoginRateLimitGuard,
    PrismaService,
    RolesGuard,
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  controllers: [AuthController],
  exports: [AuthService, TokenFamilyService, TokenBlacklistService, JwtModule, RolesGuard],
})
export class AuthModule { }
