import { Test, TestingModule } from '@nestjs/testing';
import { MailService } from './mail.service';
import { getQueueToken } from '@nestjs/bullmq';
import { MAIL_QUEUE, MailEvent } from './mail.constants';
import { PrismaService } from '../prisma.service';

describe('MailService', () => {
  let service: MailService;

  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  };

  const mockPrisma = {
    emailLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1', status: 'Pending' }),
    },
    user: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MailService,
        { provide: getQueueToken(MAIL_QUEUE), useValue: mockQueue },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MailService>(MailService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendEmail', () => {
    it('creates a log entry and enqueues the job', async () => {
      mockPrisma.emailLog.create.mockResolvedValueOnce({ id: 'log-1' });

      await service.sendEmail('user@example.com', MailEvent.WELCOME, { publicKey: 'GTEST' });

      expect(mockPrisma.emailLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            to: 'user@example.com',
            template: MailEvent.WELCOME,
          }),
        }),
      );
      expect(mockQueue.add).toHaveBeenCalledWith(
        MailEvent.WELCOME,
        expect.objectContaining({ to: 'user@example.com', logId: 'log-1' }),
      );
    });
  });

  describe('sendIfEnabled', () => {
    it('returns null when user has no email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ email: null, isSubscribed: true, notificationPreferences: null });
      const result = await service.sendIfEnabled('GTEST', MailEvent.PURCHASE_CONFIRMED, {});
      expect(result).toBeNull();
    });

    it('returns null when user is unsubscribed', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({ email: 'u@x.com', isSubscribed: false, notificationPreferences: null });
      const result = await service.sendIfEnabled('GTEST', MailEvent.PURCHASE_CONFIRMED, {});
      expect(result).toBeNull();
    });

    it('sends email when user is subscribed and has email', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        email: 'u@x.com',
        isSubscribed: true,
        notificationPreferences: { purchaseConfirmed: true },
      });
      mockPrisma.emailLog.create.mockResolvedValueOnce({ id: 'log-2' });

      const result = await service.sendIfEnabled('GTEST', MailEvent.PURCHASE_CONFIRMED, {});
      expect(result).not.toBeNull();
    });

    it('respects preference: skips when preference disabled', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        email: 'u@x.com',
        isSubscribed: true,
        notificationPreferences: { purchaseConfirmed: false },
      });
      const result = await service.sendIfEnabled('GTEST', MailEvent.PURCHASE_CONFIRMED, {});
      expect(result).toBeNull();
    });
  });

  describe('sendAdminAlert', () => {
    it('does not throw when ADMIN_ALERT_EMAIL is not set', async () => {
      delete process.env.ADMIN_ALERT_EMAIL;
      await expect(service.sendAdminAlert('Test Error', 'Something failed')).resolves.toBeUndefined();
    });

    it('enqueues an error alert when ADMIN_ALERT_EMAIL is configured', async () => {
      process.env.ADMIN_ALERT_EMAIL = 'admin@carbonledger.io';
      mockPrisma.emailLog.create.mockResolvedValueOnce({ id: 'log-3' });

      await service.sendAdminAlert('Critical Error', 'DB connection lost');
      expect(mockQueue.add).toHaveBeenCalledWith(
        MailEvent.ERROR_ALERT,
        expect.objectContaining({ to: 'admin@carbonledger.io' }),
      );
      delete process.env.ADMIN_ALERT_EMAIL;
    });
  });
});
