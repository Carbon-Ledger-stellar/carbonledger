import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiKeyGuard } from './api-key.guard';
import { PublicApiService } from './public-api.service';
import { CreateApiKeyDto } from './public-api.dto';

/**
 * Public read-only API for third-party ESG platforms and data providers.
 * Authentication: X-Api-Key header (no wallet required).
 * Rate limit: 1000 req/day per API key (enforced via throttler).
 */
@Controller('v1')
@UseGuards(ApiKeyGuard)
@Throttle({ default: { ttl: 86_400_000, limit: 1000 } })
export class PublicApiController {
  constructor(private readonly publicApiService: PublicApiService) {}

  /** List all verified carbon projects with optional filters. */
  @Get('projects')
  listProjects(
    @Query('methodology') methodology?: string,
    @Query('country') country?: string,
    @Query('vintage') vintage?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.publicApiService.listProjects({
      methodology,
      country,
      vintage: vintage ? Number(vintage) : undefined,
      limit: limit ? Math.min(Number(limit), 100) : 20,
      cursor,
    });
  }

  /** Get a single credit batch by ID. */
  @Get('credits/batch/:batchId')
  getCreditBatch(@Param('batchId') batchId: string) {
    return this.publicApiService.getCreditBatch(batchId);
  }

  /** Verify a retirement certificate by retirement ID. */
  @Get('certificates/:retirementId')
  verifyCertificate(@Param('retirementId') retirementId: string) {
    return this.publicApiService.verifyCertificate(retirementId);
  }
}

/** Separate controller for API key provisioning — no auth guard needed here. */
@Controller('v1/api-keys')
export class ApiKeyProvisionController {
  constructor(private readonly publicApiService: PublicApiService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  createApiKey(@Body() dto: CreateApiKeyDto) {
    return this.publicApiService.createApiKey(dto);
  }
}
