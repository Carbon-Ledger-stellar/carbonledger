import { Module } from '@nestjs/common';
import { PublicApiController, ApiKeyProvisionController } from './public-api.controller';
import { PublicApiService } from './public-api.service';
import { ApiKeyGuard } from './api-key.guard';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [PublicApiController, ApiKeyProvisionController],
  providers: [PublicApiService, ApiKeyGuard, PrismaService],
})
export class PublicApiModule {}
