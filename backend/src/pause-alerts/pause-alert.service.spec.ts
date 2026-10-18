import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PauseAlertService } from './pause-alert.service';
import { MailService } from '../mail/mail.service';
import { MailEvent } from '../mail/mail.constants';

// Mock axios at the module level so we can spy on individual calls
jest.mock('axios');
const mockedAxiosPost = axios.post as jest.MockedFunction<typeof axios.post>;

describe('PauseAlertService', () => {
  let service: PauseAlertService;
  let configService: jest.Mocked<ConfigService>;
  let mailService: jest.Mocked<MailService>;

  const CONTRACT = 'carbon_credit';
  const REASON = 'Critical vulnerability CVE-2024-1234 detected';
  const ADMIN = 'GABC1234ADMINKEY';
  const PAUSED_UNTIL = new Date('2026-10-16T06:00:00.000Z');
  const SLACK_URL = 'https://hooks.slack.com/services/TEST/TOKEN';
  const PD_KEY = 'test-pagerduty-routing-key';

  beforeEach(async () => {
    mockedAxiosPost.mockResolvedValue({ status: 200, data: 'ok' });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PauseAlertService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const map: Record<string, string> = {
                SLACK_PAUSE_WEBHOOK_URL: SLACK_URL,
                PAGERDUTY_ROUTING_KEY: PD_KEY,
                ADMIN_OPS_EMAIL: 'ops@carbonledger.io',
              };
              return map[key] ?? undefined;
            }),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendEmail: jest.fn().mockResolvedValue({ id: 'log-1' }),
          },
        },
      ],
    }).compile();

    service = module.get<PauseAlertService>(PauseAlertService);
    configService = module.get(ConfigService);
    mailService = module.get(MailService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── notifyPauseActivated ─────────────────────────────────────────────────

  describe('notifyPauseActivated', () => {
    it('posts to Slack with a pause-activated block-kit message', async () => {
      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);

      // Find the call that targeted SLACK_URL
      const slackCall = mockedAxiosPost.mock.calls.find(([url]) => url === SLACK_URL);
      expect(slackCall).toBeDefined();

      const body = slackCall![1] as any;
      expect(body.text).toContain('EMERGENCY PAUSE ACTIVATED');
      expect(body.text).toContain(CONTRACT);

      // Ensure all key fields appear somewhere in the blocks
      const bodyJson = JSON.stringify(body);
      expect(bodyJson).toContain(CONTRACT);
      expect(bodyJson).toContain(REASON);
      expect(bodyJson).toContain(ADMIN);
      expect(bodyJson).toContain(PAUSED_UNTIL.toISOString());
    });

    it('triggers a PagerDuty critical incident', async () => {
      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);

      const pdCall = mockedAxiosPost.mock.calls.find(([url]) =>
        (url as string).includes('pagerduty'),
      );
      expect(pdCall).toBeDefined();

      const body = pdCall![1] as any;
      expect(body.event_action).toBe('trigger');
      expect(body.routing_key).toBe(PD_KEY);
      expect(body.payload.severity).toBe('critical');
      expect(body.payload.summary).toContain(CONTRACT);
      expect(body.payload.summary).toContain(REASON);
      expect(body.payload.custom_details.contract).toBe(CONTRACT);
      expect(body.payload.custom_details.reason).toBe(REASON);
      expect(body.payload.custom_details.adminAddress).toBe(ADMIN);
    });

    it('uses a deterministic dedup_key per contract for PagerDuty', async () => {
      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);
      await service.notifyPauseActivated(CONTRACT, 'another reason', PAUSED_UNTIL, ADMIN);

      const pdCalls = mockedAxiosPost.mock.calls.filter(([url]) =>
        (url as string).includes('pagerduty'),
      );
      const dedup1 = (pdCalls[0][1] as any).dedup_key;
      const dedup2 = (pdCalls[1][1] as any).dedup_key;
      expect(dedup1).toBe(dedup2);
      expect(dedup1).toContain(CONTRACT);
    });

    it('sends an audit-trail email with the correct MailEvent', async () => {
      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);

      expect(mailService.sendEmail).toHaveBeenCalledWith(
        'ops@carbonledger.io',
        MailEvent.ERROR_ALERT,
        expect.objectContaining({
          errorTitle: expect.stringContaining('Pause Activated'),
          errorMessage: expect.stringContaining(REASON),
        }),
      );
    });

    it('includes the pause reason in the audit-trail email body', async () => {
      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);

      const emailPayload = (mailService.sendEmail as jest.Mock).mock.calls[0][2];
      expect(emailPayload.errorMessage).toContain(REASON);
      expect(emailPayload.errorMessage).toContain(ADMIN);
      expect(emailPayload.errorMessage).toContain(PAUSED_UNTIL.toISOString());
    });

    it('dispatches all three channels (Slack + PagerDuty + email)', async () => {
      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);

      // Two axios.post calls: one Slack, one PagerDuty
      expect(mockedAxiosPost).toHaveBeenCalledTimes(2);
      // One mail.sendEmail call
      expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('does not throw when Slack webhook fails', async () => {
      mockedAxiosPost.mockRejectedValueOnce(new Error('Slack network error'));

      await expect(
        service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN),
      ).resolves.not.toThrow();
    });

    it('does not throw when PagerDuty fails', async () => {
      // First call (Slack) succeeds, second call (PagerDuty) fails
      mockedAxiosPost
        .mockResolvedValueOnce({ status: 200 } as any)
        .mockRejectedValueOnce(new Error('PD timeout'));

      await expect(
        service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN),
      ).resolves.not.toThrow();
    });

    it('does not throw when email service fails', async () => {
      (mailService.sendEmail as jest.Mock).mockRejectedValueOnce(new Error('SMTP error'));

      await expect(
        service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN),
      ).resolves.not.toThrow();
    });

    it('skips Slack when SLACK_PAUSE_WEBHOOK_URL is not configured', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'SLACK_PAUSE_WEBHOOK_URL') return undefined;
        if (key === 'PAGERDUTY_ROUTING_KEY') return PD_KEY;
        if (key === 'ADMIN_OPS_EMAIL') return 'ops@carbonledger.io';
        return undefined;
      });

      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);

      const slackCall = mockedAxiosPost.mock.calls.find(([url]) => url === SLACK_URL);
      expect(slackCall).toBeUndefined();
    });

    it('skips PagerDuty when PAGERDUTY_ROUTING_KEY is not configured', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'SLACK_PAUSE_WEBHOOK_URL') return SLACK_URL;
        if (key === 'PAGERDUTY_ROUTING_KEY') return undefined;
        if (key === 'ADMIN_OPS_EMAIL') return 'ops@carbonledger.io';
        return undefined;
      });

      await service.notifyPauseActivated(CONTRACT, REASON, PAUSED_UNTIL, ADMIN);

      const pdCall = mockedAxiosPost.mock.calls.find(([url]) =>
        (url as string).includes('pagerduty'),
      );
      expect(pdCall).toBeUndefined();
    });
  });

  // ── notifyPauseLifted ───────────────────────────────────────────────────────

  describe('notifyPauseLifted', () => {
    const LIFT_REASON = 'Incident resolved — patch deployed';

    it('posts to Slack with a pause-lifted block-kit message', async () => {
      await service.notifyPauseLifted(CONTRACT, LIFT_REASON, ADMIN);

      const slackCall = mockedAxiosPost.mock.calls.find(([url]) => url === SLACK_URL);
      expect(slackCall).toBeDefined();

      const body = slackCall![1] as any;
      expect(body.text).toContain('PAUSE LIFTED');
      expect(body.text).toContain(CONTRACT);

      const bodyJson = JSON.stringify(body);
      expect(bodyJson).toContain(LIFT_REASON);
      expect(bodyJson).toContain(ADMIN);
    });

    it('does NOT trigger PagerDuty on unpause (monitoring layer resolves the incident)', async () => {
      await service.notifyPauseLifted(CONTRACT, LIFT_REASON, ADMIN);

      const pdCall = mockedAxiosPost.mock.calls.find(([url]) =>
        (url as string).includes('pagerduty'),
      );
      expect(pdCall).toBeUndefined();
    });

    it('sends an audit-trail email for unpause', async () => {
      await service.notifyPauseLifted(CONTRACT, LIFT_REASON, ADMIN);

      expect(mailService.sendEmail).toHaveBeenCalledWith(
        'ops@carbonledger.io',
        MailEvent.ERROR_ALERT,
        expect.objectContaining({
          errorTitle: expect.stringContaining('Pause Lifted'),
          errorMessage: expect.stringContaining(LIFT_REASON),
        }),
      );
    });

    it('includes the unpause reason in the audit-trail email body', async () => {
      await service.notifyPauseLifted(CONTRACT, LIFT_REASON, ADMIN);

      const emailPayload = (mailService.sendEmail as jest.Mock).mock.calls[0][2];
      expect(emailPayload.errorMessage).toContain(LIFT_REASON);
      expect(emailPayload.errorMessage).toContain(ADMIN);
    });

    it('dispatches exactly two channels (Slack + email)', async () => {
      await service.notifyPauseLifted(CONTRACT, LIFT_REASON, ADMIN);

      // One axios.post for Slack only — no PagerDuty
      expect(mockedAxiosPost).toHaveBeenCalledTimes(1);
      expect(mailService.sendEmail).toHaveBeenCalledTimes(1);
    });

    it('does not throw when Slack webhook fails on unpause', async () => {
      mockedAxiosPost.mockRejectedValueOnce(new Error('Slack down'));

      await expect(
        service.notifyPauseLifted(CONTRACT, LIFT_REASON, ADMIN),
      ).resolves.not.toThrow();
    });

    it('skips email when ADMIN_OPS_EMAIL is not configured', async () => {
      (configService.get as jest.Mock).mockImplementation((key: string) => {
        if (key === 'SLACK_PAUSE_WEBHOOK_URL') return SLACK_URL;
        if (key === 'PAGERDUTY_ROUTING_KEY') return PD_KEY;
        // Both ADMIN_OPS_EMAIL and ADMIN_ALERT_EMAIL absent
        return undefined;
      });

      await service.notifyPauseLifted(CONTRACT, LIFT_REASON, ADMIN);

      expect(mailService.sendEmail).not.toHaveBeenCalled();
    });
  });
});
