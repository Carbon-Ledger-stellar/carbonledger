/**
 * Role-based quota definitions.
 *
 * Each role has a set of named quota buckets. A bucket resets after `windowMs`
 * milliseconds. The burst multiplier allows short-term exceedance of up to 10%
 * above the base limit (i.e. burstMultiplier = 1.10).
 *
 * Under adaptive throttling (system CPU > 80% for 5+ min) the effective limit
 * is multiplied by `adaptiveMultiplier` (0.50 = half normal quota).
 */

export const BURST_MULTIPLIER   = 1.10;   // 10% burst allowance
export const ADAPTIVE_MULTIPLIER = 0.50;  // 50% of normal under high load

export type QuotaBucketDef = {
  /** Human-readable name used in headers and logs */
  name: string;
  /** Maximum requests per window (base, before burst/adaptive) */
  limit: number;
  /** Window length in milliseconds */
  windowMs: number;
};

export type RoleQuotas = {
  [bucket: string]: QuotaBucketDef;
};

/**
 * Per-role quota definitions.
 *
 * project     → 100 mint requests / day
 * corporation → 1 000 purchase requests / day
 * public      → 100 read requests / hour
 *
 * Any endpoint not covered by a specific bucket falls back to the 'default'
 * bucket for that role.
 */
export const ROLE_QUOTAS: Record<string, RoleQuotas> = {
  project: {
    mint: {
      name: 'mint',
      limit: 100,
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
    },
    default: {
      name: 'default',
      limit: 200,
      windowMs: 60 * 60 * 1000, // 1 hour
    },
  },
  corporation: {
    purchase: {
      name: 'purchase',
      limit: 1000,
      windowMs: 24 * 60 * 60 * 1000, // 24 hours
    },
    default: {
      name: 'default',
      limit: 500,
      windowMs: 60 * 60 * 1000, // 1 hour
    },
  },
  public: {
    read: {
      name: 'read',
      limit: 100,
      windowMs: 60 * 60 * 1000, // 1 hour
    },
    default: {
      name: 'default',
      limit: 100,
      windowMs: 60 * 60 * 1000, // 1 hour
    },
  },
};

/** Bucket name assigned to each HTTP method family. */
export const METHOD_BUCKET_MAP: Record<string, string> = {
  POST:   'write',
  PUT:    'write',
  PATCH:  'write',
  DELETE: 'write',
  GET:    'read',
  HEAD:   'read',
};

/** Path-prefix → bucket name overrides (take priority over method mapping). */
export const PATH_BUCKET_OVERRIDES: Array<{ prefix: string; bucket: string }> = [
  { prefix: '/api/v1/credits/mint',          bucket: 'mint' },
  { prefix: '/api/v1/marketplace/purchase',  bucket: 'purchase' },
  { prefix: '/api/v1/marketplace/bulk-purchase', bucket: 'purchase' },
  { prefix: '/api/v1/credits/retire',        bucket: 'purchase' },
];
