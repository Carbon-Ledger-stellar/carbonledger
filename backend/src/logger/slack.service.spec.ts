import { Test, TestingModule } from '@nestjs/testing';
import { SlackService } from './slack.service';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SlackService', () => {
  let service: SlackService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SlackService],
    }).compile();

    service = module.get<SlackService>(SlackService);
    jest.clearAllMocks();
  });

  describe('when ADMIN_ALERT_WEBHOOK is not set', () => {
    beforeEach(() => {
      delete process.env.ADMIN_ALERT_WEBHOOK;
    });

    it('does not call axios for notifyDeployCompleted', async () => {
      await service.notifyDeployCompleted({ environment: 'testnet', version: '1.0.0', deployedBy: 'ci' });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('does not call axios for notifyError', async () => {
      await service.notifyError({ title: 'DB Error', message: 'Connection lost' });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('does not call axios for sendDailyDigest', async () => {
      await service.sendDailyDigest({ activeListings: 5, transactions24h: 10, creditsRetired24h: 100, revenueUsdc24h: 5000, newUsers24h: 3, errors24h: 0 });
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });
  });

  describe('when ADMIN_ALERT_WEBHOOK is set', () => {
    const WEBHOOK = 'https://hooks.slack.com/services/TEST/WEBHOOK';

    beforeEach(() => {
      process.env.ADMIN_ALERT_WEBHOOK = WEBHOOK;
      mockedAxios.post.mockResolvedValue({ status: 200 });
    });

    afterEach(() => {
      delete process.env.ADMIN_ALERT_WEBHOOK;
    });

    it('posts to webhook on notifyDeployCompleted', async () => {
      await service.notifyDeployCompleted({
        environment: 'production',
        version: '2.1.0',
        deployedBy: 'github-actions',
        commitSha: 'abc1234def5678',
        duration: '2m 30s',
      });
      expect(mockedAxios.post).toHaveBeenCalledWith(
        WEBHOOK,
        expect.objectContaining({ blocks: expect.any(Array) }),
        expect.any(Object),
      );
    });

    it('posts error alert with severity icon', async () => {
      await service.notifyError({
        title: 'Critical DB failure',
        message: 'Cannot connect to PostgreSQL',
        severity: 'critical',
        context: { host: 'db.prod', attempt: 3 },
      });
      const body = mockedAxios.post.mock.calls[0][1] as any;
      const headerText = body.blocks[0].text.text as string;
      expect(headerText).toContain(':red_circle:');
      expect(headerText).toContain('CRITICAL');
    });

    it('posts warning alert with correct icon', async () => {
      await service.notifyError({ title: 'Slow query', message: 'Query took 5s', severity: 'warning' });
      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(body.blocks[0].text.text).toContain(':warning:');
    });

    it('does NOT post high-value alert when amount is below threshold', async () => {
      process.env.SLACK_HIGH_VALUE_THRESHOLD = '10000';
      await service.notifyHighValueTransaction({
        type: 'purchase',
        amount: 500,
        buyerPublicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ123456',
      });
      expect(mockedAxios.post).not.toHaveBeenCalled();
      delete process.env.SLACK_HIGH_VALUE_THRESHOLD;
    });

    it('posts high-value alert when amount meets threshold', async () => {
      process.env.SLACK_HIGH_VALUE_THRESHOLD = '1000';
      await service.notifyHighValueTransaction({
        type: 'retirement',
        amount: 50000,
        buyerPublicKey: 'GABCDE12345678',
        projectId: 'proj-001',
        methodology: 'REDD+',
      });
      expect(mockedAxios.post).toHaveBeenCalled();
      const body = mockedAxios.post.mock.calls[0][1] as any;
      const headerText = body.blocks[0].text.text as string;
      expect(headerText).toContain('High-Value Retirement');
      delete process.env.SLACK_HIGH_VALUE_THRESHOLD;
    });

    it('masks public key in high-value alert', async () => {
      process.env.SLACK_HIGH_VALUE_THRESHOLD = '1';
      await service.notifyHighValueTransaction({
        type: 'purchase',
        amount: 100,
        buyerPublicKey: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ1234ABCD',
      });
      const body = mockedAxios.post.mock.calls[0][1] as any;
      const bodyStr = JSON.stringify(body);
      // Full public key should not appear
      expect(bodyStr).not.toContain('GABCDEFGHIJKLMNOPQRSTUVWXYZ1234ABCD');
      // Should contain partial (first 8)
      expect(bodyStr).toContain('GABCDEFG');
      delete process.env.SLACK_HIGH_VALUE_THRESHOLD;
    });

    it('posts daily digest with all fields', async () => {
      await service.sendDailyDigest({
        activeListings: 42,
        transactions24h: 100,
        creditsRetired24h: 5000,
        revenueUsdc24h: 250000,
        newUsers24h: 7,
        errors24h: 2,
      });
      expect(mockedAxios.post).toHaveBeenCalled();
      const body = mockedAxios.post.mock.calls[0][1] as any;
      expect(JSON.stringify(body)).toContain('Daily Digest');
    });

    it('does not throw when axios rejects', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error'));
      await expect(
        service.notifyError({ title: 'Test', message: 'fail' }),
      ).resolves.toBeUndefined();
    });
  });
});
