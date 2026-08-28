import { Module } from '@nestjs/common';
import { PublicApiController, ApiKeyProvisionController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../prisma.service';
import { CreditsModule } from '../credits/credits.module';
import { PublicSerialController } from './serial.controller';
import { AbuseDetectorGuard } from '../security/abuse.guard';

@Module({
  imports: [CreditsModule],
  controllers: [PublicApiController, ApiKeyProvisionController, PublicSerialController],
  providers: [PublicApiService, ApiKeyGuard, PrismaService, AbuseDetectorGuard],
})
export class PublicApiModule {}
