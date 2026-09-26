import {
  Injectable,
  Logger,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';

/** Rate-limit entry for faucet requests */
interface FaucetRateLimitEntry {
  lastFundedAt: number;
  count: number;
}

/** Response from a faucet fund request */
export interface FaucetFundResult {
  funded: boolean;
  txHash?: string;
  message: string;
  address: string;
}

/**
 * FaucetService — Stellar Testnet Friendbot Integration
 *
 * Funds Stellar testnet accounts via Friendbot. Only active when
 * STELLAR_NETWORK=testnet. Rate-limits per-address to one request
 * per 24 hours to prevent abuse.
 *
 * Issue #1083: Testnet faucet integration for local development.
 */
@Injectable()
export class FaucetService {
  private readonly logger = new Logger(FaucetService.name);
  private readonly faucetUrl: string;
  private readonly isTestnet: boolean;

  /** In-memory rate limit store: publicKey → { lastFundedAt, count } */
  private readonly rateLimitStore = new Map<string, FaucetRateLimitEntry>();

  /** 24 hours in milliseconds */
  static readonly RATE_LIMIT_TTL_MS = 24 * 60 * 60 * 1000;

  constructor() {
    this.faucetUrl =
      process.env.STELLAR_FAUCET_URL || 'https://friendbot.stellar.org';
    this.isTestnet =
      (process.env.STELLAR_NETWORK || 'testnet') === 'testnet';
  }

  /**
   * Fund a Stellar testnet account via Friendbot.
   *
   * @param publicKey - The Stellar public key (G...) to fund
   * @returns FaucetFundResult with success/failure status and tx hash
   * @throws BadRequestException if not on testnet or invalid public key
   * @throws ServiceUnavailableException if Friendbot is unreachable
   */
  async fundAccount(publicKey: string): Promise<FaucetFundResult> {
    // Guard: only allowed on testnet
    if (!this.isTestnet) {
      throw new BadRequestException(
        'Faucet is only available on Stellar testnet. Set STELLAR_NETWORK=testnet.',
      );
    }

    // Validate the Stellar public key format
    this.validatePublicKey(publicKey);

    // Rate limit check
    this.checkRateLimit(publicKey);

    this.logger.log(`Funding testnet account: ${publicKey}`);

    try {
      const url = `${this.faucetUrl}?addr=${encodeURIComponent(publicKey)}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'GET',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        const errorText = await response
          .text()
          .catch(() => `HTTP ${response.status}`);

        // Friendbot returns 400 if account already exists with funds
        if (
          response.status === 400 &&
          errorText.includes('createAccountAlreadyExist')
        ) {
          this.logger.warn(
            `Account ${publicKey} already exists on testnet`,
          );
          return {
            funded: false,
            message:
              'Account already exists on testnet and has funds.',
            address: publicKey,
          };
        }

        throw new Error(
          `Friendbot error ${response.status}: ${errorText}`,
        );
      }

      const result = (await response.json()) as {
        hash?: string;
        id?: string;
      };
      const txHash = result.hash ?? result.id;

      // Record successful fund for rate limiting
      this.recordFundRequest(publicKey);

      this.logger.log(
        `Successfully funded ${publicKey}, tx: ${txHash}`,
      );

      return {
        funded: true,
        txHash,
        message: 'Account successfully funded with 10,000 testnet XLM.',
        address: publicKey,
      };
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Faucet request failed for ${publicKey}: ${msg}`);
      throw new ServiceUnavailableException(
        'Testnet faucet (Friendbot) is temporarily unavailable. Please try again later.',
      );
    }
  }

  /**
   * Check if the given address is within the 24-hour rate limit window.
   * Throws BadRequestException if so.
   */
  checkRateLimit(publicKey: string): void {
    const entry = this.rateLimitStore.get(publicKey);
    if (!entry) return;

    const elapsed = Date.now() - entry.lastFundedAt;
    if (elapsed < FaucetService.RATE_LIMIT_TTL_MS) {
      const remainingMs = FaucetService.RATE_LIMIT_TTL_MS - elapsed;
      const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
      throw new BadRequestException(
        `This address was recently funded. Wait ${remainingHours} hour(s) before requesting again.`,
      );
    }

    this.rateLimitStore.delete(publicKey);
  }

  private recordFundRequest(publicKey: string): void {
    const existing = this.rateLimitStore.get(publicKey);
    this.rateLimitStore.set(publicKey, {
      lastFundedAt: Date.now(),
      count: (existing?.count ?? 0) + 1,
    });
  }

  private validatePublicKey(publicKey: string): void {
    if (!publicKey || typeof publicKey !== 'string') {
      throw new BadRequestException('publicKey is required');
    }
    try {
      StellarSdk.Keypair.fromPublicKey(publicKey);
    } catch {
      throw new BadRequestException(
        'Invalid Stellar public key. Must start with G and be 56 characters (base32).',
      );
    }
  }

  get isAvailable(): boolean {
    return this.isTestnet;
  }
}
