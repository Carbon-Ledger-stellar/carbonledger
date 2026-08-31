import { Module, Global } from '@nestjs/common';
import { QuotaStore } from './quota.store';
import { RedisQuotaStore } from './redis-quota.store';
import { AdaptiveLoadMonitor } from './adaptive-load.monitor';
import { RoleLimitGuard } from './role-limit.guard';
import { RedisRoleLimitGuard } from './redis-role-limit.guard';
import { RedisModule } from '../redis/redis.module';

/**
 * ThrottleModule is marked @Global so all quota stores, monitors, and guards
 * are available across feature modules without re-importing.
 *
 * Provides:
 *   QuotaStore          — in-memory store (original)
 *   RedisQuotaStore     — Redis-backed store with in-memory fallback (issue #1017)
 *   AdaptiveLoadMonitor — CPU-based adaptive throttling monitor
 *   RoleLimitGuard      — synchronous in-memory guard (original)
 *   RedisRoleLimitGuard — async Redis-backed guard (issue #1017)
 */
@Global()
@Module({
  imports: [RedisModule],
  providers: [
    QuotaStore,
    RedisQuotaStore,
    AdaptiveLoadMonitor,
    RoleLimitGuard,
    RedisRoleLimitGuard,
  ],
  exports: [
    QuotaStore,
    RedisQuotaStore,
    AdaptiveLoadMonitor,
    RoleLimitGuard,
    RedisRoleLimitGuard,
  ],
})
export class ThrottleModule {}
