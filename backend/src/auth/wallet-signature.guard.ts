import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { WalletSignatureService } from './wallet-signature.service';

export const SKIP_WALLET_SIGNATURE_KEY = 'skipWalletSignature';

/**
 * WalletSignatureGuard — per-request Ed25519 wallet signature enforcement.
 *
 * Applied to endpoints that require proof the caller controls the wallet
 * they claim to own (e.g. initiating a retirement, transferring credits).
 *
 * Expected request headers:
 *   X-Wallet-Public-Key  — Stellar public key (G...)
 *   X-Wallet-Signature   — Hex-encoded Ed25519 signature
 *   X-Wallet-Nonce       — Single-use random string (min 16 chars)
 *   X-Wallet-Timestamp   — Unix epoch milliseconds at signing time
 *
 * The signature must cover the canonical payload:
 *   `${timestamp}:${nonce}:${canonicalBody}`
 * where canonicalBody is the request body JSON with keys sorted alphabetically.
 *
 * Issue #1078: Wallet Signature Verification.
 */
@Injectable()
export class WalletSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WalletSignatureGuard.name);

  constructor(
    private readonly walletSigService: WalletSignatureService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Allow skipping via @SkipWalletSignature() decorator
    const skip = this.reflector.getAllAndOverride<boolean>(
      SKIP_WALLET_SIGNATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skip) return true;

    const request = context.switchToHttp().getRequest<Request>();

    const publicKey = this.extractHeader(request, 'x-wallet-public-key');
    const signature = this.extractHeader(request, 'x-wallet-signature');
    const nonce = this.extractHeader(request, 'x-wallet-nonce');
    const timestampRaw = this.extractHeader(request, 'x-wallet-timestamp');

    if (!publicKey || !signature || !nonce || !timestampRaw) {
      throw new UnauthorizedException(
        'Missing required wallet signature headers: X-Wallet-Public-Key, X-Wallet-Signature, X-Wallet-Nonce, X-Wallet-Timestamp.',
      );
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      throw new UnauthorizedException(
        'X-Wallet-Timestamp must be a valid Unix epoch millisecond value.',
      );
    }

    if (nonce.length < 16) {
      throw new UnauthorizedException(
        'X-Wallet-Nonce must be at least 16 characters long.',
      );
    }

    const body =
      request.body && typeof request.body === 'object'
        ? (request.body as Record<string, unknown>)
        : {};

    const result = this.walletSigService.verifyRequestSignature(
      publicKey,
      signature,
      nonce,
      timestamp,
      body,
    );

    if (!result.valid) {
      this.logger.warn(
        `Wallet signature rejected for ${publicKey}: ${result.reason}`,
      );
      throw new UnauthorizedException(
        result.reason ?? 'Wallet signature verification failed.',
      );
    }

    // Attach verified wallet info to the request for downstream handlers
    (request as any).walletPublicKey = publicKey;
    return true;
  }

  private extractHeader(req: Request, name: string): string | undefined {
    const val = req.headers[name];
    if (!val) return undefined;
    return Array.isArray(val) ? val[0] : val;
  }
}
