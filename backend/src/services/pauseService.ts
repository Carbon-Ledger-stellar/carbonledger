import { Redis } from 'ioredis';
import { getRedisClient } from '../config/redis';
import { PauseStateRepository } from '../repositories/pauseStateRepository';
import { PauseState } from '../types/pauseState';

const PAUSE_STATUS_CACHE_KEY = 'contract:pause:status';
const PAUSE_STATUS_CACHE_TTL_SECONDS = 30;

export class PauseService {
  private readonly pauseStateRepository: PauseStateRepository;
  private readonly redis: Redis;

  constructor(
    pauseStateRepository: PauseStateRepository = new PauseStateRepository(),
    redis: Redis = getRedisClient(),
  ) {
    this.pauseStateRepository = pauseStateRepository;
    this.redis = redis;
  }

  /**
   * Returns the current pause state, using Redis as a read-through cache.
   * Falls back to the database on a cache miss and repopulates the cache.
   */
  async getPauseState(): Promise<PauseState> {
    const cached = await this.redis.get(PAUSE_STATUS_CACHE_KEY);
    if (cached !== null) {
      return JSON.parse(cached) as PauseState;
    }

    const pauseState = await this.pauseStateRepository.getPauseState();
    await this.redis.set(
      PAUSE_STATUS_CACHE_KEY,
      JSON.stringify(pauseState),
      'EX',
      PAUSE_STATUS_CACHE_TTL_SECONDS,
    );

    return pauseState;
  }

  /**
   * Pauses the contract and invalidates the cached pause state.
   */
  async pause(): Promise<PauseState> {
    const pauseState = await this.pauseStateRepository.pause();
    await this.invalidatePauseStateCache();
    return pauseState;
  }

  /**
   * Unpauses the contract and invalidates the cached pause state.
   */
  async unpause(): Promise<PauseState> {
    const pauseState = await this.pauseStateRepository.unpause();
    await this.invalidatePauseStateCache();
    return pauseState;
  }

  /**
   * Removes the cached pause state so the next read is served from the database.
   */
  async invalidatePauseStateCache(): Promise<void> {
    await this.redis.del(PAUSE_STATUS_CACHE_KEY);
  }
}
