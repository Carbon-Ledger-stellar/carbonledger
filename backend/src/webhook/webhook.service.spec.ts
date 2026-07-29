import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { WebhookService } from './webhook.service';
import { PrismaService } from '../prisma.service';

// Prevent @prisma/client from being loaded (generated types not available in CI)
jest.mock('../prisma.service');
jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    $use = jest.fn();
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));

// BullMQ queue mock
const queueMock = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
};

describe('WebhookService', () => {
  let service: WebhookService;
  let subDb: any;
  let logDb: any;
  let userDb: any;

  beforeEach(async () => {
    // Fresh in-memory store per test
    const subscriptions: any[] = [];
    const logs: any[] = [];
    const users: any[] = [{ publicKey: 'GCORP123', email: 'corp@test.com' }];

    subDb = {
      create: jest.fn(({ data }: any) => {
        const sub = { id: `sub-${subscriptions.length + 1}`, ...data, createdAt: new Date() };
        subscriptions.push(sub);
        return Promise.resolve(sub);
      }),
      findUnique: jest.fn(({ where }: any) => {
        return Promise.resolve(subscriptions.find((s) => s.id === where.id) ?? null);
      }),
      findMany: jest.fn(({ where }: any) => {
        let results = [...subscriptions];
        if (where?.ownerAddress) results = results.filter((s) => s.ownerAddress === where.ownerAddress);
        if (where?.active !== undefined) results = results.filter((s) => s.active === where.active);
        if (where?.id) results = results.filter((s) => s.id === where.id);
        if (where?.events?.has) results = results.filter((s) => s.events.includes(where.events.has));
        return Promise.resolve(results);
      }),
      findFirst: jest.fn(({ where }: any) => {
        const found = subscriptions.find((s) => s.url === where.url && s.ownerAddress === where.ownerAddress);
        return Promise.resolve(found ?? null);
      }),
      update: jest.fn(({ where, data }: any) => {
        const idx = subscriptions.findIndex((s) => s.id === where.id);
        if (idx >= 0) {
          subscriptions[idx] = { ...subscriptions[idx], ...data };
          return Promise.resolve(subscriptions[idx]);
        }
        return Promise.resolve(null);
      }),
    };

    logDb = {
      create: jest.fn(({ data }: any) => {
        const log = { id: `log-${logs.length + 1}`, ...data, timestamp: new Date() };
        logs.push(log);
        return Promise.resolve(log);
      }),
      findMany: jest.fn(({ where, orderBy, skip, take }: any) => {
        let results = [...logs];
        if (where?.subscriptionId) results = results.filter((l) => l.subscriptionId === where.subscriptionId);
        if (orderBy?.timestamp === 'desc') results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        if (skip) results = results.slice(skip);
        if (take) results = results.slice(0, take);
        return Promise.resolve(results);
      }),
      count: jest.fn(({ where }: any) => {
        let results = [...logs];
        if (where?.subscriptionId) results = results.filter((l) => l.subscriptionId === where.subscriptionId);
        return Promise.resolve(results.length);
      }),
    };

    userDb = {
      findUnique: jest.fn(() => Promise.resolve(users[0])),
    };

    const prismaMock = {
      webhookSubscription: subDb,
      webhookDeliveryLog: logDb,
      user: userDb,
      $use: jest.fn(),
      $connect: jest.fn(),
      $disconnect: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: 'BullQueue_carbonledger-outbound-webhooks', useValue: queueMock },
      ],
    }).compile();

    service = module.get(WebhookService);
    jest.clearAllMocks();
  });

  // ── subscribe ──────────────────────────────────────────────────────

  describe('subscribe', () => {
    const dto = {
      ownerAddress: 'GCORP123',
      url: 'https://esg.example.com/webhook',
      events: ['retirement.confirmed', 'certificate.ready'] as any,
    };

    it('creates a new subscription with a generated secret', async () => {
      const sub = await service.subscribe(dto);
      expect(sub.url).toBe(dto.url);
      expect(sub.ownerAddress).toBe(dto.ownerAddress);
      expect(sub.active).toBe(true);
      expect(sub.secret).toHaveLength(64); // 32-byte hex
    });

    it('throws ConflictException for duplicate active subscription', async () => {
      await service.subscribe(dto);
      await expect(service.subscribe(dto)).rejects.toThrow(ConflictException);
    });

    it('reactivates an inactive subscription', async () => {
      const sub = await service.subscribe(dto);
      // Simulate deactivation
      await subDb.update({ where: { id: sub.id }, data: { active: false } });
      // Reactivate
      const reactivated = await service.subscribe(dto);
      expect(reactivated.id).toBe(sub.id);
      expect(reactivated.active).toBe(true);
    });
  });

  // ── unsubscribe ────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('deactivates a subscription owned by the caller', async () => {
      const sub = await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });

      const result = await service.unsubscribe(sub.id, 'GCORP123');
      expect(result.active).toBe(false);
    });

    it('throws BadRequestException when caller does not own the subscription', async () => {
      const sub = await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });

      await expect(service.unsubscribe(sub.id, 'GOTHER789')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException for non-existent subscription', async () => {
      await expect(service.unsubscribe('non-existent', 'GCORP123')).rejects.toThrow(NotFoundException);
    });
  });

  // ── dispatch ───────────────────────────────────────────────────────

  describe('dispatch', () => {
    it('enqueues a job for each matching active subscription', async () => {
      await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg1.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });
      await service.subscribe({
        ownerAddress: 'GOTHER456',
        url: 'https://esg2.example.com/webhook',
        events: ['retirement.confirmed', 'credit.purchased'] as any,
      });
      // This one should NOT match
      await service.subscribe({
        ownerAddress: 'GANOTHER',
        url: 'https://esg3.example.com/webhook',
        events: ['certificate.ready'] as any,
      });

      await service.dispatch('retirement.confirmed', { retirementId: 'R1' });

      // Should have 2 queue additions (from 2 matching subscriptions)
      expect(queueMock.add).toHaveBeenCalledTimes(2);
    });

    it('does nothing when no subscriptions match', async () => {
      await service.dispatch('credit.purchased', { listingId: 'L1' });
      expect(queueMock.add).not.toHaveBeenCalled();
    });

    it('skips inactive subscriptions', async () => {
      const sub = await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });

      // Deactivate
      await service.unsubscribe(sub.id, 'GCORP123');

      await service.dispatch('retirement.confirmed', { retirementId: 'R1' });
      expect(queueMock.add).not.toHaveBeenCalled();
    });
  });

  // ── HMAC signing ───────────────────────────────────────────────────

  describe('computeSignature', () => {
    it('produces a consistent SHA-256 HMAC', () => {
      const secret = 'test-secret-hex';
      const timestamp = 1751234567;
      const payload = { event: 'test' };

      const sig1 = service.computeSignature(secret, timestamp, payload);
      const sig2 = service.computeSignature(secret, timestamp, payload);

      expect(sig1).toBe(sig2);
      expect(sig1).toHaveLength(64); // hex-encoded SHA-256
    });

    it('produces different signatures for different payloads', () => {
      const secret = 'test-secret-hex';
      const timestamp = 1751234567;

      const sig1 = service.computeSignature(secret, timestamp, { event: 'a' });
      const sig2 = service.computeSignature(secret, timestamp, { event: 'b' });

      expect(sig1).not.toBe(sig2);
    });
  });

  // ── delivery logs ──────────────────────────────────────────────────

  describe('getDeliveryLogs', () => {
    it('returns paginated delivery logs for a subscription', async () => {
      const sub = await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });

      await service.recordDeliveryAttempt({
        subscriptionId: sub.id,
        eventType: 'retirement.confirmed',
        url: sub.url,
        statusCode: 200,
        success: true,
        attempt: 1,
      });
      await service.recordDeliveryAttempt({
        subscriptionId: sub.id,
        eventType: 'retirement.confirmed',
        url: sub.url,
        statusCode: 500,
        success: false,
        attempt: 2,
        error: 'Internal Server Error',
      });

      const result = await service.getDeliveryLogs(sub.id, 'GCORP123', 1, 20);
      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('throws when caller does not own the subscription', async () => {
      const sub = await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });

      await expect(service.getDeliveryLogs(sub.id, 'GOTHER456')).rejects.toThrow(BadRequestException);
    });
  });

  // ── deactivateSubscription ─────────────────────────────────────────

  describe('deactivateSubscription', () => {
    it('sets active to false', async () => {
      const sub = await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });

      await service.deactivateSubscription(sub.id);
      const result = await service.getSubscription(sub.id, 'GCORP123');
      expect(result.active).toBe(false);
    });
  });

  // ── recordDeliveryAttempt ──────────────────────────────────────────

  describe('recordDeliveryAttempt', () => {
    it('truncates response body to 1000 characters', async () => {
      const sub = await service.subscribe({
        ownerAddress: 'GCORP123',
        url: 'https://esg.example.com/webhook',
        events: ['retirement.confirmed'] as any,
      });

      const longBody = 'x'.repeat(5000);
      const log = await service.recordDeliveryAttempt({
        subscriptionId: sub.id,
        eventType: 'retirement.confirmed',
        url: sub.url,
        statusCode: 200,
        responseBody: longBody,
        success: true,
        attempt: 1,
      });

      expect(log.responseBody.length).toBeLessThanOrEqual(1000);
    });
  });
});
