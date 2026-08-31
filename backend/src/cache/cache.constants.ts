export const PROJECT_DETAIL_CACHE_KEY_PREFIX = 'project-detail:';
export const PROJECT_DETAIL_CACHE_TTL_SECONDS = 60;

export const projectDetailCacheKey = (projectId: string) => `${PROJECT_DETAIL_CACHE_KEY_PREFIX}${projectId}`;

// ── Endpoint response cache key prefixes ─────────────────────────────────────
// All use the "cache:" prefix to comply with RedisService key validation.

export const CACHE_PREFIX = 'cache:';

// Projects list — cache keyed by query params; 60 s TTL
export const PROJECTS_LIST_CACHE_KEY_PREFIX = 'cache:projects:list:';
export const PROJECTS_LIST_CACHE_TTL_SECONDS = 60;

// Marketplace listings — 5 min TTL
export const MARKETPLACE_LISTINGS_CACHE_KEY_PREFIX = 'cache:marketplace:listings:';
export const MARKETPLACE_LISTINGS_CACHE_TTL_SECONDS = 300;

// Marketplace listing by id — 5 min TTL
export const MARKETPLACE_LISTING_DETAIL_CACHE_KEY_PREFIX = 'cache:marketplace:listing:';
export const MARKETPLACE_LISTING_DETAIL_CACHE_TTL_SECONDS = 300;

// Marketplace search — 2 min TTL
export const MARKETPLACE_SEARCH_CACHE_KEY_PREFIX = 'cache:marketplace:search:';
export const MARKETPLACE_SEARCH_CACHE_TTL_SECONDS = 120;

// Oracle status per project — 5 min TTL
export const ORACLE_STATUS_CACHE_KEY_PREFIX = 'cache:oracle:status:';
export const ORACLE_STATUS_CACHE_TTL_SECONDS = 300;

// Oracle services health — 30 s TTL
export const ORACLE_HEALTH_CACHE_KEY = 'cache:oracle:health';
export const ORACLE_HEALTH_CACHE_TTL_SECONDS = 30;

// Platform stats — 60 s TTL
export const STATS_CACHE_KEY = 'cache:stats:platform';
export const STATS_CACHE_TTL_SECONDS = 60;

// Aggregate stats — 60 s TTL
export const STATS_AGGREGATE_CACHE_KEY = 'cache:stats:aggregate';
export const STATS_AGGREGATE_CACHE_TTL_SECONDS = 60;

// Leaderboard — 5 min TTL (keyed by optional year)
export const STATS_LEADERBOARD_CACHE_KEY_PREFIX = 'cache:stats:leaderboard:';
export const STATS_LEADERBOARD_CACHE_TTL_SECONDS = 300;

// Credits by project — 5 min TTL
export const CREDITS_BATCH_CACHE_KEY_PREFIX = 'cache:credits:project:';
export const CREDITS_BATCH_CACHE_TTL_SECONDS = 300;

// Retirement records list (public) — 30 s TTL
export const RETIREMENTS_LIST_CACHE_KEY_PREFIX = 'cache:retirements:list:';
export const RETIREMENTS_LIST_CACHE_TTL_SECONDS = 30;

// ── Cache key helpers ────────────────────────────────────────────────────────

export const projectsListCacheKey = (query: Record<string, unknown>) =>
  `${PROJECTS_LIST_CACHE_KEY_PREFIX}${JSON.stringify(query)}`;

export const marketplaceListingsCacheKey = (query: Record<string, unknown>) =>
  `${MARKETPLACE_LISTINGS_CACHE_KEY_PREFIX}${JSON.stringify(query)}`;

export const marketplaceListingDetailCacheKey = (id: string) =>
  `${MARKETPLACE_LISTING_DETAIL_CACHE_KEY_PREFIX}${id}`;

export const marketplaceSearchCacheKey = (query: Record<string, unknown>) =>
  `${MARKETPLACE_SEARCH_CACHE_KEY_PREFIX}${JSON.stringify(query)}`;

export const oracleStatusCacheKey = (projectId: string) =>
  `${ORACLE_STATUS_CACHE_KEY_PREFIX}${projectId}`;

export const statsLeaderboardCacheKey = (year?: number) =>
  `${STATS_LEADERBOARD_CACHE_KEY_PREFIX}${year ?? 'all'}`;

export const creditsBatchCacheKey = (projectId: string) =>
  `${CREDITS_BATCH_CACHE_KEY_PREFIX}${projectId}`;

export const retirementsListCacheKey = (caller: string, query: Record<string, unknown>) =>
  `${RETIREMENTS_LIST_CACHE_KEY_PREFIX}${caller}:${JSON.stringify(query)}`;
