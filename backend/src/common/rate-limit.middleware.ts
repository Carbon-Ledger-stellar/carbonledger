import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RedisSlidingWindowRateLimitGuard } from './redis-sliding-window-rate-limit.guard';
import { RedisService } from '../redis.service';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private readonly redisService: RedisService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const guard = new RedisSlidingWindowRateLimitGuard(this.redisService);
    void guard.canActivate({
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => res,
      }),
    } as any).then((allowed) => {
      if (!allowed) {
        return;
      }
      next();
    }).catch(() => next());
  }
}
