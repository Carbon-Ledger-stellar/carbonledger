import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PublicApiController, ApiKeyProvisionController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../prisma.service';
import { CreditsModule } from '../credits/credits.module';
import { PublicSerialController } from './serial.controller';
import { AbuseDetectorGuard } from '../security/abuse.guard';
import { ApiKeyThrottlerGuard } from './api-key-throttler.guard';

@Module({
  imports: [
    CreditsModule,
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 60 },
      { name: 'basic', ttl: 60_000, limit: 300 },
      { name: 'premium', ttl: 60_000, limit: 1200 },
    ]),
  ],
  controllers: [PublicApiController, ApiKeyProvisionController, PublicSerialController],
  providers: [
    PublicApiService,
    ApiKeyGuard,
    PrismaService,
    AbuseDetectorGuard,
    ApiKeyThrottlerGuard,
    { provide: APP_GUARD, useClass: ApiKeyThrottlerGuard },
  ],
})
export class PublicApiModule {}
