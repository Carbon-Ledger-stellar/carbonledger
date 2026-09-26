/**
 * cache.module.ts
 *
 * Provides and exports:
 *   - ApiCacheService     — generic cache-aside helper (closes #1070)
 *   - CacheInvalidationService — targeted cache busting on writes
 */

import { Module } from '@nestjs/common';
import { ApiCacheService } from './api-cache.service';
import { CacheInvalidationService } from './cache.service';
import { ListingsCacheService } from '../marketplace/listings-cache.service';

@Module({
  providers: [ApiCacheService, CacheInvalidationService, ListingsCacheService],
  exports: [ApiCacheService, CacheInvalidationService],
})
export class CacheModule {}
