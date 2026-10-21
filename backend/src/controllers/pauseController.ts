import { Request, Response } from 'express';
import { getRedisClient } from '../config/redis';
import { PauseService } from '../services/pauseService';

const PAUSE_STATUS_CACHE_KEY = 'contract:pause:status';
const PAUSE_STATUS_CACHE_TTL_SECONDS = 30;

const pauseService = new PauseService();

async function readCachedPauseStatus(): Promise<boolean | null> {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(PAUSE_STATUS_CACHE_KEY);
    if (cached === null || cached === undefined) {
      return null;
    }
    return cached === 'true' || cached === '1';
  } catch (error) {
    return null;
  }
}

async function writeCachedPauseStatus(paused: boolean): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.set(
      PAUSE_STATUS_CACHE_KEY,
      paused ? 'true' : 'false',
      'EX',
      PAUSE_STATUS_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    // Cache write failures must not break pause/unpause operations.
  }
}

async function invalidatePauseStatusCache(): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.del(PAUSE_STATUS_CACHE_KEY);
  } catch (error) {
    // Cache invalidation failures must not break pause/unpause operations.
  }
}

export async function getPauseStatus(req: Request, res: Response): Promise<void> {
  const cached = await readCachedPauseStatus();
  if (cached !== null) {
    res.status(200).json({ paused: cached, cached: true });
    return;
  }

  const paused = await pauseService.isPaused();
  await writeCachedPauseStatus(paused);
  res.status(200).json({ paused, cached: false });
}

export async function pauseContract(req: Request, res: Response): Promise<void> {
  await pauseService.pause();
  await invalidatePauseStatusCache();
  res.status(200).json({ paused: true });
}

export async function unpauseContract(req: Request, res: Response): Promise<void> {
  await pauseService.unpause();
  await invalidatePauseStatusCache();
  res.status(200).json({ paused: false });
}
