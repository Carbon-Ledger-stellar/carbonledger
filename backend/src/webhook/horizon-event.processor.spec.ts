import { HorizonEventProcessor } from './horizon-event.processor';
import { WebhookService } from './webhook.service';

function makeJob(overrides: Partial<any> = {}) {
  return {
    data: {
      type: 'monitoring_data_submitted',
      contractId: 'CORACLE1',
      ledger: 12345,
      txHash: 'TX1',
      payload: { projectId: 'P1', tonnesVerified: 100 },
    },
    ...overrides,
  } as any;
}

describe('HorizonEventProcessor', () => {
  let processor: HorizonEventProcessor;
  let webhookService: jest.Mocked<WebhookService>;

  beforeEach(() => {
    webhookService = { dispatch: jest.fn().mockResolvedValue(undefined) } as any;
    processor = new HorizonEventProcessor(webhookService);
  });

  it('dispatches monitoring.data_submitted for monitoring_data_submitted horizon events', async () => {
    const job = makeJob();
    const result = await processor.process(job);

    expect(webhookService.dispatch).toHaveBeenCalledWith(
      'monitoring.data_submitted',
      expect.objectContaining({ contractId: 'CORACLE1', ledger: 12345, txHash: 'TX1', projectId: 'P1' }),
    );
    expect(result).toEqual({ dispatched: true, outboundEvent: 'monitoring.data_submitted' });
  });

  it('dispatches oracle.price_updated for price_updated horizon events', async () => {
    const job = makeJob({
      data: {
        type: 'price_updated',
        contractId: 'CORACLE1',
        ledger: 12346,
        txHash: 'TX2',
        payload: { methodology: 'VCS', vintageYear: 2023, priceUsdc: 1400 },
      },
    });

    await processor.process(job);

    expect(webhookService.dispatch).toHaveBeenCalledWith(
      'oracle.price_updated',
      expect.objectContaining({ methodology: 'VCS' }),
    );
  });

  it('does not dispatch for event types without an outbound mapping (avoids duplicate delivery)', async () => {
    const job = makeJob({
      data: { type: 'credit_retired', contractId: 'CCREDIT1', ledger: 1, txHash: 'TX3', payload: {} },
    });

    const result = await processor.process(job);

    expect(webhookService.dispatch).not.toHaveBeenCalled();
    expect(result).toEqual({ dispatched: false });
  });
});
