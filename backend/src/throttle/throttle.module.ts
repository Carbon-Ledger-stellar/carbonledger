import { Module, Global } from '@nestjs/common';
import { QuotaStore } from './quota.store';
import { AdaptiveLoadMonitor } from './adaptive-load.monitor';
import { RoleLimitGuard } from './role-limit.guard';

/**
 * ThrottleModule is marked @Global so QuotaStore, AdaptiveLoadMonitor, and
 * RoleLimitGuard are available across all feature modules without re-importing.
 */
@Global()
@Module({
  providers: [QuotaStore, AdaptiveLoadMonitor, RoleLimitGuard],
  exports:   [QuotaStore, AdaptiveLoadMonitor, RoleLimitGuard],
})
export class ThrottleModule {}
