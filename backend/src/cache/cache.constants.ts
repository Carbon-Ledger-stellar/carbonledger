export const PROJECT_DETAIL_CACHE_KEY_PREFIX = 'project-detail:';
export const PROJECT_DETAIL_CACHE_TTL_SECONDS = 60;

export const projectDetailCacheKey = (projectId: string) => `${PROJECT_DETAIL_CACHE_KEY_PREFIX}${projectId}`;
