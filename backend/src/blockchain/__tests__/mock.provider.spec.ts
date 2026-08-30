/**
 * Mock Blockchain Provider Tests
 * 
 * Tests the mock provider's behavior for simulating:
 * - Successful transactions
 * - Insufficient balance errors
 * - Overlapping serial errors
 * - Network errors
 */

import { Test, TestingModule } from '@nestjs/testing';
import { MockBlockchainProvider } from '../mock.provider';

describe('MockBlockchainProvider', () => {
  let provider: MockBlockchainProvider;

  beforeEach(() => {
    provider = new MockBlockchainProvider();
  });

  afterEach(() => {
    provider.reset();
  });

  describe('contract invocation', () => {
    it('should successfully mint credits', async () => {
      const contractId = 'test-contract';
      provider.setContractData(contractId, 'mint', { total: 0 });

      const result = await provider.invokeContract({
        contractId,
        method: 'mint_credits',
        args: ['PROJ001', 1000, 'SN-001', 'SN-1000'],
      });

      expect(result.status).toBe('success');
      expect(result.events).toBeDefined();
    });

    it('should fail with insufficient balance error', async () => {
      provider.configureErrorSimulation({
        simulateErrors: true,
        errorRate: 1.0,
        errorTypes: ['INSUFFICIENT_BALANCE'],
      });

      const result = await provider.invokeContract({
        contractId: 'test-contract',
        method: 'mint_credits',
        args: ['PROJ001', 1000, 'SN-001', 'SN-1000'],
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Insufficient balance');
    });

    it('should fail with overlapping serial error', async () => {
      const contractId = 'test-contract';
      
      // First mint
      await provider.invokeContract({
        contractId,
        method: 'mint_credits',
        args: ['PROJ001', 100, 'SN-001', 'SN-100'],
      });

      // Second mint with overlapping serials
      provider.configureErrorSimulation({
        simulateErrors: true,
        errorRate: 1.0,
        errorTypes: ['OVERLAPPING_SERIAL'],
      });

      const result = await provider.invokeContract({
        contractId,
        method: 'mint_credits',
        args: ['PROJ001', 100, 'SN-050', 'SN-150'],
      });

      expect(result.status).toBe('failed');
      expect(result.error).toContain('Serial number already used');
    });
  });

  describe('account balance', () => {
    it('should return correct balance for known account', async () => {
      provider.setAccountBalance('GABCD', {
        native: '1000',
        tokens: { USDC: '500' },
      });

      const balance = await provider.getAccountBalance('GABCD');
      expect(balance.balances.native).toBe('1000');
      expect(balance.balances.tokens.USDC).toBe('500');
    });

    it('should return zero balance for unknown account', async () => {
      const balance = await provider.getAccountBalance('GUNKNOWN');
      expect(balance.balances.native).toBe('0');
    });
  });

  describe('health check', () => {
    it('should always return healthy', async () => {
      const healthy = await provider.isHealthy();
      expect(healthy).toBe(true);
    });
  });

  describe('transaction history', () => {
    it('should track transaction history', async () => {
      await provider.invokeContract({
        contractId: 'test',
        method: 'test_method',
        args: [],
      });

      const history = provider['state'].transactionHistory;
      expect(history.length).toBe(1);
    });
  });
});
