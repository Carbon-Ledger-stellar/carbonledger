import { Test, TestingModule } from '@nestjs/testing';
import { PauseAlertService } from './pause-alert.service';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';
import { WebhookService } from '../webhook/webhook.service';
import { PauseStatusChangedEvent } from './contract-state-sync.service';

const makePrisma = () => ({
  pauseAlertLog: {
    create: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue(null), // no cooldown by default
  },
});

const makeMailService = () => ({
  sendAdminAlert: jest.fn().mockResolvedValue(undefined),
});

const makeWebhookService = () => ({
  dispatch: jest.fn().mockResolvedValue(undefined),
});

function buildEvent(
  overrides: Partial<PauseStatusChangedEvent> = {},
): PauseStatusChangedEvent {
  return new PauseStatusChangedEvent(
    overrides.contractName ?? ('carbon_credit' as any),
    overrides.contractId ?? 'C_CREDIT_ID',
    overrides.isPaused ?? true,
    overrides.reason ?? 'Security incident',
    overrides.pausedUntil ?? new Date(Date.now() + 3600_000),
    overrides.changedAt ?? new Date(),
  );
}

describe('PauseAlertService', () => {
  let service: PauseAlertService;
  let prisma: ReturnType<typeof makePrisma>;
  let mailService: ReturnType<typeof makeMailService>;
  let webhookService: ReturnType<typeof makeWebhookService>;

  beforeEach(async () => {
    prisma = makePrisma();
    mailService = makeMailService();
    webhookService = makeWebhookService();

    // Set environment variables
    process.env.PAUSE_ALERT_EMAIL = 'ops@carbonledger.io';
    process.env.PAUSE_ALERT_SLACK_WEBHOOK = '';
    process.env.PAUSE_ALERT_WEBHOOK_URL = '';
    process.env.PAUSE_ALERT_COOLDOWN_SECS = '300';

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PauseAlertService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mailService },
        { provide: WebhookService, useValue: webhookService },
      ],
    }).compile();

    service = module.get(PauseAlertService);
  });

  afterEach(() => {
    delete process.env.PAUSE_ALERT_EMAIL;
    delete process.env.PAUSE_ALERT_SLACK_WEBHOOK;
    delete process.env.PAUSE_ALERT_WEBHOOK_URL;
    delete process.env.PAUSE_ALERT_COOLDOWN_SECS;
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('handlePauseStatusChanged()', () => {
    it('sends an email alert on pause', async () => {
      const event = buildEvent({ isPaused: true });
      await service.handlePauseStatusChanged(event);

      expect(mailService.sendAdminAlert).toHaveBeenCalledWith(
        expect.stringContaining('PAUSED'),
        expect.stringContaining('carbon_credit'),
        expect.stringContaining('carbon_credit'),
      );
    });

    it('sends an email alert on unpause', async () => {
      const event = buildEvent({ isPaused: false });
      await service.handlePauseStatusChanged(event);

      expect(mailService.sendAdminAlert).toHaveBeenCalledWith(
        expect.stringContaining('RESUMED'),
        expect.any(String),
        expect.any(String),
      );
    });

    it('includes pause reason in email body', async () => {
      const event = buildEvent({ reason: 'Exploit detected' });
      await service.handlePauseStatusChanged(event);

      const [, body] = mailService.sendAdminAlert.mock.calls[0];
      expect(body).toContain('Exploit detected');
    });

    it('logs a sent record for each successful dispatch', async () => {
      const event = buildEvent();
      await service.handlePauseStatusChanged(event);

      expect(prisma.pauseAlertLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contractId: 'C_CREDIT_ID',
            action: 'pause',
            status: 'sent',
          }),
        }),
      );
    });

    it('skips alert and logs skipped_cooldown when cooldown is active', async () => {
      // Simulate a recent alert within the cooldown window
      prisma.pauseAlertLog.findFirst.mockResolvedValue({
        id: '1',
        sentAt: new Date(),
      });

      const event = buildEvent();
      await service.handlePauseStatusChanged(event);

      expect(mailService.sendAdminAlert).not.toHaveBeenCalled();
      expect(prisma.pauseAlertLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'skipped_cooldown' }),
        }),
      );
    });

    it('logs failed status when email throws', async () => {
      mailService.sendAdminAlert.mockRejectedValue(new Error('SMTP error'));

      const event = buildEvent();
      await service.handlePauseStatusChanged(event);

      // Should not throw, but should log a failed record
      expect(prisma.pauseAlertLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'failed',
            error: expect.stringContaining('SMTP error'),
          }),
        }),
      );
    });

    it('dispatches to slack channel when PAUSE_ALERT_SLACK_WEBHOOK is set', async () => {
      process.env.PAUSE_ALERT_SLACK_WEBHOOK = 'https://hooks.slack.com/test';

      // Mock fetch globally
      const mockFetch = jest.fn().mockResolvedValue({ ok: true, text: jest.fn().mockResolvedValue('') });
      (global as any).fetch = mockFetch;

      const event = buildEvent();
      await service.handlePauseStatusChanged(event);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.slack.com/test',
        expect.objectContaining({ method: 'POST' }),
      );

      delete (global as any).fetch;
    });

    it('dispatches contract.paused webhook event on pause', async () => {
      process.env.PAUSE_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

      const event = buildEvent({ isPaused: true });
      await service.handlePauseStatusChanged(event);

      expect(webhookService.dispatch).toHaveBeenCalledWith(
        'contract.paused',
        expect.objectContaining({
          contract: 'carbon_credit',
          action: 'pause',
        }),
      );
    });

    it('dispatches contract.unpaused webhook event on unpause', async () => {
      process.env.PAUSE_ALERT_WEBHOOK_URL = 'https://example.com/webhook';

      const event = buildEvent({ isPaused: false });
      await service.handlePauseStatusChanged(event);

      expect(webhookService.dispatch).toHaveBeenCalledWith(
        'contract.unpaused',
        expect.objectContaining({
          contract: 'carbon_credit',
          action: 'unpause',
        }),
      );
    });

    it('does not throw if no channels are configured', async () => {
      delete process.env.PAUSE_ALERT_EMAIL;
      process.env.PAUSE_ALERT_SLACK_WEBHOOK = '';
      process.env.PAUSE_ALERT_WEBHOOK_URL = '';

      const event = buildEvent();
      await expect(service.handlePauseStatusChanged(event)).resolves.not.toThrow();
    });
  });

  describe('notifyPauseChange()', () => {
    it('sends alert with explicit reason', async () => {
      await service.notifyPauseChange({
        contractName: 'carbon_marketplace',
        contractId: 'C_MARKET_ID',
        isPaused: true,
        reason: 'Manual override',
      });

      const [, body] = mailService.sendAdminAlert.mock.calls[0];
      expect(body).toContain('Manual override');
    });
  });
});
