import { CustomThrottlerGuard } from './custom-throttler.guard';

describe('CustomThrottlerGuard', () => {
  let guard: CustomThrottlerGuard;

  beforeEach(() => {
    // Instantiate with minimal stubs — we only test getTracker and throwThrottlingException
    guard = Object.create(CustomThrottlerGuard.prototype);
  });

  describe('getTracker', () => {
    it('returns user:publicKey for authenticated requests', async () => {
      const req: any = { user: { publicKey: 'GABC123' }, ip: '1.2.3.4' };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('user:GABC123');
    });

    it('returns IP for unauthenticated requests', async () => {
      const req: any = { ip: '1.2.3.4' };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('1.2.3.4');
    });

    it('falls back to socket address when ip is missing', async () => {
      const req: any = { socket: { remoteAddress: '5.6.7.8' } };
      const tracker = await (guard as any).getTracker(req);
      expect(tracker).toBe('5.6.7.8');
    });
  });

  describe('throwThrottlingException', () => {
    it('sends 429 with Retry-After and X-RateLimit headers', async () => {
      const headers: Record<string, string> = {};
      let sentBody: any;
      const res: any = {
        headersSent: false,
        status: jest.fn().mockReturnThis(),
        set: jest.fn().mockImplementation((k: string, v: string) => { headers[k] = v; return res; }),
        json: jest.fn().mockImplementation((body: any) => { sentBody = body; return res; }),
      };
      const context: any = {
        switchToHttp: () => ({ getResponse: () => res }),
      };
      const detail: any = { timeToExpire: 30_000, limit: 100, totalHits: 101, key: 'k', tracker: 't', isBlocked: true, timeToBlockExpire: 30_000, ttl: 60_000 };

      await expect((guard as any).throwThrottlingException(context, detail)).rejects.toBeDefined();

      expect(res.status).toHaveBeenCalledWith(429);
      expect(headers['Retry-After']).toBe('30');
      expect(headers['X-RateLimit-Limit']).toBe('100');
      expect(headers['X-RateLimit-Remaining']).toBe('0');
      expect(sentBody.statusCode).toBe(429);
      expect(sentBody.retryAfter).toBe(30);
    });

    it('does not send response if headers already sent', async () => {
      const res: any = { headersSent: true, status: jest.fn(), set: jest.fn(), json: jest.fn() };
      const context: any = { switchToHttp: () => ({ getResponse: () => res }) };
      const detail: any = { timeToExpire: 10_000, limit: 100, totalHits: 101, key: 'k', tracker: 't', isBlocked: true, timeToBlockExpire: 10_000, ttl: 60_000 };

      await expect((guard as any).throwThrottlingException(context, detail)).rejects.toBeDefined();
      expect(res.status).not.toHaveBeenCalled();
    });
  });
});
