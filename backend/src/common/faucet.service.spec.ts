import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FaucetService } from './faucet.service';
import * as StellarSdk from '@stellar/stellar-sdk';

// A valid testnet public key for testing
const VALID_PUBLIC_KEY = StellarSdk.Keypair.random().publicKey();
const INVALID_PUBLIC_KEY = 'NOTAVALIDKEY';

describe('FaucetService', () => {
  let service: FaucetService;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.STELLAR_NETWORK = 'testnet';
    process.env.STELLAR_FAUCET_URL = 'https://friendbot.stellar.org';
    service = new FaucetService();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  // ── isAvailable ────────────────────────────────────────────────────────────

  describe('isAvailable', () => {
    it('returns true when STELLAR_NETWORK=testnet', () => {
      expect(service.isAvailable).toBe(true);
    });

    it('returns false when STELLAR_NETWORK=public', () => {
      process.env.STELLAR_NETWORK = 'public';
      const svc = new FaucetService();
      expect(svc.isAvailable).toBe(false);
    });
  });

  // ── fundAccount — mainnet guard ────────────────────────────────────────────

  describe('fundAccount (mainnet guard)', () => {
    it('throws BadRequestException when not on testnet', async () => {
      process.env.STELLAR_NETWORK = 'public';
      const svc = new FaucetService();
      await expect(svc.fundAccount(VALID_PUBLIC_KEY)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── fundAccount — public key validation ───────────────────────────────────

  describe('fundAccount (key validation)', () => {
    it('throws BadRequestException for invalid public key', async () => {
      await expect(
        service.fundAccount(INVALID_PUBLIC_KEY),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for empty string', async () => {
      await expect(service.fundAccount('')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── fundAccount — successful response ─────────────────────────────────────

  describe('fundAccount (success)', () => {
    it('returns funded=true with txHash on success', async () => {
      const mockTxHash = 'abc123def456';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hash: mockTxHash }),
      } as Response);

      const result = await service.fundAccount(VALID_PUBLIC_KEY);

      expect(result.funded).toBe(true);
      expect(result.txHash).toBe(mockTxHash);
      expect(result.address).toBe(VALID_PUBLIC_KEY);
      expect(result.message).toContain('10,000');
    });

    it('uses id field as txHash if hash is absent', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'txid-from-id' }),
      } as Response);

      const result = await service.fundAccount(VALID_PUBLIC_KEY);
      expect(result.txHash).toBe('txid-from-id');
    });
  });

  // ── fundAccount — account already exists ──────────────────────────────────

  describe('fundAccount (already exists)', () => {
    it('returns funded=false when account already exists', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: async () =>
          '{"detail":"createAccountAlreadyExist"}',
      } as Response);

      const result = await service.fundAccount(VALID_PUBLIC_KEY);

      expect(result.funded).toBe(false);
      expect(result.address).toBe(VALID_PUBLIC_KEY);
    });
  });

  // ── fundAccount — Friendbot errors ────────────────────────────────────────

  describe('fundAccount (Friendbot errors)', () => {
    it('throws ServiceUnavailableException on non-400 HTTP error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      } as Response);

      await expect(service.fundAccount(VALID_PUBLIC_KEY)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it('throws ServiceUnavailableException when fetch throws', async () => {
      global.fetch = jest.fn().mockRejectedValue(
        new Error('Network error'),
      );

      await expect(service.fundAccount(VALID_PUBLIC_KEY)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────

  describe('checkRateLimit', () => {
    it('does not throw for an address that has never been funded', () => {
      expect(() =>
        service.checkRateLimit(VALID_PUBLIC_KEY),
      ).not.toThrow();
    });

    it('throws BadRequestException for recently funded address', async () => {
      // Fund the account once
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hash: 'tx1' }),
      } as Response);
      await service.fundAccount(VALID_PUBLIC_KEY);

      // Second request within 24h should be rate-limited
      await expect(
        service.fundAccount(VALID_PUBLIC_KEY),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows funding again after the rate limit window expires', async () => {
      // Fund once
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hash: 'tx1' }),
      } as Response);
      await service.fundAccount(VALID_PUBLIC_KEY);

      // Manually expire the rate limit entry
      const store = (service as any).rateLimitStore as Map<string, { lastFundedAt: number; count: number }>;
      store.set(VALID_PUBLIC_KEY, {
        lastFundedAt:
          Date.now() - FaucetService.RATE_LIMIT_TTL_MS - 1000,
        count: 1,
      });

      // Second request should succeed now
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ hash: 'tx2' }),
      } as Response);

      const result = await service.fundAccount(VALID_PUBLIC_KEY);
      expect(result.funded).toBe(true);
    });
  });
});
