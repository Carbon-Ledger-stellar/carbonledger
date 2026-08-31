export type RateLimitTierName = 'unauthenticated' | 'authenticated' | 'financial';

export interface RateLimitTierConfig {
  name: RateLimitTierName;
  limit: number;
  windowMs: number;
  burstAllowance: number;
}

export interface RouteTierOverride {
  matcher: RegExp;
  tier: RateLimitTierName;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readRouteOverrides(): RouteTierOverride[] {
  const raw = process.env.RATE_LIMIT_ROUTE_OVERRIDES ?? '';
  if (!raw.trim()) {
    return [
      { matcher: /^\/auth\//i, tier: 'unauthenticated' },
      { matcher: /\/purchase|\/retire|\/retirements/i, tier: 'financial' },
    ];
  }

  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [pattern, tier] = entry.split(':').map((piece) => piece.trim());
      if (!pattern || !tier) return null;
      return {
        matcher: new RegExp(pattern.replace(/^\^?/, '').replace(/\$$/, ''), 'i'),
        tier: tier as RateLimitTierName,
      };
    })
    .filter((entry): entry is RouteTierOverride => Boolean(entry));
}

const routeOverrides = readRouteOverrides();

export const RATE_LIMIT_TIERS: Record<RateLimitTierName, RateLimitTierConfig> = {
  // #1076: 10 req/sec per IP for unauthenticated (public) traffic.
  // windowMs=1000 enforces a strict per-second sliding window.
  unauthenticated: {
    name: 'unauthenticated',
    limit: readNumberEnv('RATE_LIMIT_UNAUTHENTICATED_LIMIT', 10),
    windowMs: readNumberEnv('RATE_LIMIT_UNAUTHENTICATED_WINDOW_MS', 1_000),
    burstAllowance: readNumberEnv('RATE_LIMIT_UNAUTHENTICATED_BURST_ALLOWANCE', 2),
  },
  // #1076: 100 req/sec for authenticated users.
  authenticated: {
    name: 'authenticated',
    limit: readNumberEnv('RATE_LIMIT_AUTHENTICATED_LIMIT', 100),
    windowMs: readNumberEnv('RATE_LIMIT_AUTHENTICATED_WINDOW_MS', 1_000),
    burstAllowance: readNumberEnv('RATE_LIMIT_AUTHENTICATED_BURST_ALLOWANCE', 10),
  },
  // Financial endpoints keep their own conservative window (unchanged).
  financial: {
    name: 'financial',
    limit: readNumberEnv('RATE_LIMIT_FINANCIAL_LIMIT', 20),
    windowMs: readNumberEnv('RATE_LIMIT_FINANCIAL_WINDOW_MS', 60_000),
    burstAllowance: readNumberEnv('RATE_LIMIT_FINANCIAL_BURST_ALLOWANCE', 5),
  },
};

export function getRouteTier(pathname: string): RateLimitTierName {
  const override = routeOverrides.find((entry) => entry.matcher.test(pathname));
  return override?.tier ?? 'authenticated';
}

export function getTierConfig(tier: RateLimitTierName): RateLimitTierConfig {
  return RATE_LIMIT_TIERS[tier];
}
