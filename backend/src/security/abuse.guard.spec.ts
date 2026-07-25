import { Test, TestingModule } from '@nestjs/common';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AbuseDetectorGuard } from './abuse.guard';
import { RedisService } from '../redis.service';

describe('AbuseDetectorGuard', () => {
  let guard: AbuseDetectorGuard;
  let redisClientMock: any;

  beforeEach(async () => {
    redisClientMock = {
      get: jest.fn(),
      set: jest.fn(),
      multi: jest.fn().mockReturnThis(),
      zadd: jest.fn().mockReturnThis(),
      zremrangebyscore: jest.fn().mockReturnThis(),
      zcard: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      lpush: jest.fn().mockReturnThis(),
      ltrim: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        [null, 1], // zadd
        [null, 0], // zremrangebyscore
        [null, 5], // zcard (unique serials count)
        [null, 1], // expire
      ]),
    };

    const redisServiceMock = {
      isConnected: true,
      getClient: jest.fn().mockReturnValue(redisClientMock),
    };

    process.env.HONEYPOT_SERIALS = '111111,222222';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AbuseDetectorGuard,
        { provide: RedisService, useValue: redisServiceMock },
      ],
    }).compile();

    guard = module.get<AbuseDetectorGuard>(AbuseDetectorGuard);
  });

  const createMockContext = (ip: string, serials: string[], bodySerials?: string[]) => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { 'x-forwarded-for': ip },
          params: { serial: serials.length === 1 && !bodySerials ? serials[0] : undefined },
          body: bodySerials ? { serials: bodySerials } : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  };

  it('should allow normal requests', async () => {
    const context = createMockContext('1.2.3.4', ['1001']);
    redisClientMock.get.mockResolvedValue(null);
    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);
  });

  it('should throw ForbiddenException if IP is already blocked', async () => {
    const context = createMockContext('1.2.3.4', ['1001']);
    redisClientMock.get.mockResolvedValue('1');
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should block IP instantly if honeypot serial is queried', async () => {
    const context = createMockContext('1.2.3.4', ['111111']);
    redisClientMock.get.mockResolvedValue(null);
    
    // override exec to succeed for the blockIp call
    redisClientMock.exec.mockResolvedValueOnce(null);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    
    expect(redisClientMock.set).toHaveBeenCalledWith(
      'abuse:blocked:1.2.3.4', '1', 'EX', 86400
    );
    expect(redisClientMock.lpush).toHaveBeenCalled();
  });

  it('should block IP if unique serials in 1 hour exceed 1000', async () => {
    const context = createMockContext('2.3.4.5', ['1002']);
    redisClientMock.get.mockResolvedValue(null);
    
    redisClientMock.exec.mockResolvedValueOnce([
      [null, 1], // zadd
      [null, 0], // zremrangebyscore
      [null, 1001], // zcard (simulating > 1000)
      [null, 1], // expire
    ]).mockResolvedValueOnce(null); // for blockIp multi

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    
    expect(redisClientMock.set).toHaveBeenCalledWith(
      'abuse:blocked:2.3.4.5', '1', 'EX', 86400
    );
    expect(redisClientMock.lpush).toHaveBeenCalled();
  });

  it('should handle bulk lookups properly', async () => {
    const context = createMockContext('3.4.5.6', [], ['100', '101', '102']);
    redisClientMock.get.mockResolvedValue(null);
    const canActivate = await guard.canActivate(context);
    expect(canActivate).toBe(true);
    expect(redisClientMock.zadd).toHaveBeenCalledTimes(3);
  });
});
