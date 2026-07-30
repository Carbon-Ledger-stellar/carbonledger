import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import * as crypto from 'crypto';

/**
 * Authenticates requests from the Python oracle services.
 * The oracle signs a SHA-256 digest of the canonical request body
 * with its Stellar keypair. No JWT is involved.
 *
 * Request headers required:
 *   X-Oracle-Signature: <hex-encoded Ed25519 signature>
 *   X-Oracle-Timestamp: <unix ms — rejected if >5 min old>
 *
 * Signed message: `oracle:<timestamp>:<sha256(body)>`
 */
@Injectable()
export class OracleGuard implements CanActivate {
  private readonly oraclePublicKey =
    process.env.ORACLE_PUBLIC_KEY ?? '';

  canActivate(context: ExecutionContext): boolean {
    if (!this.oraclePublicKey) {
      throw new ForbiddenException('Oracle public key not configured');
    }

    const req = context.switchToHttp().getRequest();
    const signature: string = req.headers['x-oracle-signature'] ?? '';
    const timestamp: string = req.headers['x-oracle-timestamp'] ?? '';

    if (!signature || !timestamp) {
      throw new ForbiddenException('Missing oracle authentication headers');
    }

    // Reject stale requests (replay protection)
    const ts = Number(timestamp);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      throw new ForbiddenException('Oracle request timestamp expired');
    }

    // Canonical body digest
    const rawBody: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const message = `oracle:${timestamp}:${bodyHash}`;

    try {
      const keypair = StellarSdk.Keypair.fromPublicKey(this.oraclePublicKey);
      const valid = keypair.verify(
        Buffer.from(message, 'utf8'),
        Buffer.from(signature, 'hex'),
      );
      if (!valid) throw new Error();
    } catch {
      throw new ForbiddenException('Invalid oracle signature');
    }

    return true;
  }
}
