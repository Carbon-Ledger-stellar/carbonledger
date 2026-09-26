import { FinancialTracingService } from './financial-tracing.service';

describe('FinancialTracingService', () => {
  it('scrubs secrets from financial traces', () => {
    const logger = {
      log: jest.fn(),
      error: jest.fn(),
    } as any;

    const service = new FinancialTracingService(logger);
    service.logFinancialOperation('purchase', {
      user_id: 'user-1',
      operation: 'purchase',
      contract_function: 'buyCredits',
      tx_hash: 'tx-123',
      authorization: 'secret-token',
    });

    expect(logger.log).toHaveBeenCalledWith(
      'purchase',
      expect.objectContaining({
        user_id: 'user-1',
        operation: 'purchase',
        contract_function: 'buyCredits',
        tx_hash: 'tx-123',
        authorization: '[REDACTED]',
      }),
    );
  });
});
