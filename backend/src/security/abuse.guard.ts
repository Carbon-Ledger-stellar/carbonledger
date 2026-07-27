import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { RedisService } from '../redis.service';

@Injectable()
export class AbuseDetectorGuard implements CanActivate {
  private readonly logger = new Logger(AbuseDetectorGuard.name);

  // Honeypot serial numbers: can be configured via environment or fallback
  private honeypotSerials: Set<string>;

  constructor(private readonly redisService: RedisService) {
    const honeypotsStr = process.env.HONEYPOT_SERIALS || '000000,999999';
    this.honeypotSerials = new Set(honeypotsStr.split(',').map(s => s.trim()));
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const clientIp = this.clientIp(req);
    
    const redisClient = this.redisService.getClient();
    // If Redis is not connected, fail open to avoid breaking legitimate requests
    if (!redisClient || !this.redisService.isConnected) {
      return true;
    }

    const blockKey = `abuse:blocked:${clientIp}`;

    // 1. Check if IP is already blocked
    const isBlocked = await redisClient.get(blockKey);
    if (isBlocked) {
      throw new ForbiddenException('IP blocked due to abuse detection');
    }

    // 2. Extract requested serials from params or body
    let requestedSerials: string[] = [];
    if (req.params.serial) {
      requestedSerials.push(req.params.serial);
    } else if (req.body && Array.isArray(req.body.serials)) {
      requestedSerials.push(...req.body.serials);
    }

    if (requestedSerials.length === 0) {
      return true;
    }

    const now = Date.now();

    // 3. Honeypot check
    for (const serial of requestedSerials) {
      if (this.honeypotSerials.has(serial)) {
        await this.blockIp(redisClient, clientIp, 'honeypot_triggered', serial);
        throw new ForbiddenException('IP blocked due to abuse detection');
      }
    }

    // 4. Sliding window enumeration check (Redis sorted set)
    const sortedSetKey = `abuse:serials:${clientIp}`;
    
    const multi = redisClient.multi();
    
    // Add all requested serials to the sorted set with current timestamp as score
    for (const serial of requestedSerials) {
      multi.zadd(sortedSetKey, now, serial);
    }

    // Remove entries older than 1 hour (3600000 ms)
    const oneHourAgo = now - 3600000;
    multi.zremrangebyscore(sortedSetKey, '-inf', oneHourAgo);
    
    // Count unique serials in the 1-hour window
    multi.zcard(sortedSetKey);
    
    // Set a TTL on the sorted set so it expires if inactive
    multi.expire(sortedSetKey, 3600);

    const results = await multi.exec();
    if (!results) return true;

    // The result of zcard is at index 2 of the multi/exec results array
    const zcardResult = results[2];
    const uniqueSerialsCount = zcardResult[1] as number;

    if (uniqueSerialsCount > 1000) {
      await this.blockIp(redisClient, clientIp, 'enumeration_detected', null);
      throw new ForbiddenException('IP blocked due to abuse detection');
    }

    return true;
  }

  private async blockIp(redisClient: any, ip: string, reason: string, triggerSerial: string | null) {
    this.logger.warn(`Blocking IP ${ip}. Reason: ${reason}`);
    
    // Block for 24 hours
    await redisClient.set(`abuse:blocked:${ip}`, '1', 'EX', 24 * 60 * 60);

    // Log the incident to abuse:log list
    const logEntry = JSON.stringify({
      ip,
      timestamp: new Date().toISOString(),
      reason,
      triggerSerial,
    });

    const multi = redisClient.multi();
    multi.lpush('abuse:log', logEntry);
    multi.ltrim('abuse:log', 0, 999); // Keep only the latest 1000 logs
    await multi.exec();
  }

  private clientIp(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.socket?.remoteAddress ?? 'unknown';
  }
}
