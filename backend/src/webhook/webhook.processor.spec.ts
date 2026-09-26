import axios from 'axios';
import { WebhookProcessor } from './webhook.processor';
import { WebhookService } from './webhook.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeJob(overrides: Partial<any> = {}) {
  return {
    data: {
      subscriptionId: 'sub-1',
      url: 'https://esg.example.com/webhook',
      secret: 'test-secret',
      eventType: 'retirement.confirmed',
      payload: { retirementId: 'R1' },
      attempt: 1,
    },
    attemptsMade: 0,
    opts: { attempts: 10 },
    ...overrides,
  } as any;
}

describe('WebhookProcessor', () => {
  let processor: WebhookProcessor;
  let webhookService: jest.Mocked<WebhookService>;

  beforeEach(() => {
    webhookService = {
      computeSignature: jest.fn((secret, timestamp, payload) => 'deadbeef'),
      recordDeliveryAttempt: jest.fn().mockResolvedValue(undefined),
      deactivateSubscription: jest.fn().mockResolvedValue(undefined),
      getSubscriptionOwnerEmail: jest.fn().mockResolvedValue('corp@test.com'),
    } as any;

    processor = new WebhookProcessor(webhookService);
    jest.clearAllMocks();
  });

  it('delivers successfully and records the attempt with the HMAC signature header', async () => {
    mockedAxios.post.mockResolvedValue({ status: 200, data: { ok: true } });

    const job = makeJob();
    const result = await processor.process(job);

    expect(result).toEqual({ delivered: true, statusCode: 200, attempt: 1 });
    expect(webhookService.computeSignature).toHaveBeenCalledWith(
      'test-secret',
      expect.any(Number),
      { retirementId: 'R1' },
    );

    const [, , axiosOpts] = mockedAxios.post.mock.calls[0];
    expect(axiosOpts.headers['X-CarbonLedger-Signature']).toBe('sha256=deadbeef');
    expect(axiosOpts.headers['X-CarbonLedger-Event']).toBe('retirement.confirmed');

    expect(webhookService.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub-1', success: true, statusCode: 200 }),
    );
    expect(webhookService.deactivateSubscription).not.toHaveBeenCalled();
  });

  it('throws to trigger a BullMQ retry on a non-2xx response, without deactivating mid-retry', async () => {
    mockedAxios.post.mockResolvedValue({ status: 500, data: 'Internal Server Error' });

    const job = makeJob({ attemptsMade: 2 }); // attempt 3 of 10 — not the last

    await expect(processor.process(job)).rejects.toThrow('HTTP 500');

    expect(webhookService.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, statusCode: 500 }),
    );
    expect(webhookService.deactivateSubscription).not.toHaveBeenCalled();
  });

  it('deactivates the subscription and looks up the owner email after the final attempt fails', async () => {
    mockedAxios.post.mockRejectedValue(new Error('ECONNREFUSED'));

    const job = makeJob({ attemptsMade: 9 }); // attempt 10 of 10 — last attempt

    await expect(processor.process(job)).rejects.toThrow('ECONNREFUSED');

    expect(webhookService.recordDeliveryAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'ECONNREFUSED' }),
    );
    expect(webhookService.deactivateSubscription).toHaveBeenCalledWith('sub-1');
    expect(webhookService.getSubscriptionOwnerEmail).toHaveBeenCalledWith('sub-1');
  });

  it('does not deactivate the subscription on a network error before the final attempt', async () => {
    mockedAxios.post.mockRejectedValue(new Error('timeout'));

    const job = makeJob({ attemptsMade: 0 }); // attempt 1 of 10

    await expect(processor.process(job)).rejects.toThrow('timeout');
    expect(webhookService.deactivateSubscription).not.toHaveBeenCalled();
  });
});
