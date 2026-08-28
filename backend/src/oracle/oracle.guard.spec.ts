import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import * as crypto from 'crypto';
import { OracleGuard } from './oracle.guard';

function makeContext(headers: Record<string, string>, body: object): ExecutionContext {
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, body, rawBody }),
    }),
  } as unknown as ExecutionContext;
}

function sign(keypair: StellarSdk.Keypair, timestamp: string, body: object): string {
  const rawBody = Buffer.from(JSON.stringify(body));
  const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
  const message = `oracle:${timestamp}:${bodyHash}`;
  return keypair.sign(Buffer.from(message, 'utf8')).toString('hex');
}

describe('OracleGuard', () => {
  let guard: OracleGuard;
  let keypair: StellarSdk.Keypair;

  beforeEach(async () => {
    keypair = StellarSdk.Keypair.random();
    process.env.ORACLE_PUBLIC_KEY = keypair.publicKey();

    const module: TestingModule = await Test.createTestingModule({
      providers: [OracleGuard],
    }).compile();

    guard = module.get(OracleGuard);
  });

  const body = { projectId: 'proj-001', period: '2024-Q1' };

  it('allows a valid oracle signature', () => {
    const ts = String(Date.now());
    const sig = sign(keypair, ts, body);
    const ctx = makeContext({ 'x-oracle-signature': sig, 'x-oracle-timestamp': ts }, body);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects missing headers', () => {
    const ctx = makeContext({}, body);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects a stale timestamp (>5 min)', () => {
    const ts = String(Date.now() - 6 * 60 * 1000);
    const sig = sign(keypair, ts, body);
    const ctx = makeContext({ 'x-oracle-signature': sig, 'x-oracle-timestamp': ts }, body);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects a wrong signature', () => {
    const ts = String(Date.now());
    const ctx = makeContext({
      'x-oracle-signature': Buffer.alloc(64).toString('hex'),
      'x-oracle-timestamp': ts,
    }, body);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects a signature from a different keypair', () => {
    const ts = String(Date.now());
    const otherKeypair = StellarSdk.Keypair.random();
    const sig = sign(otherKeypair, ts, body);
    const ctx = makeContext({ 'x-oracle-signature': sig, 'x-oracle-timestamp': ts }, body);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('rejects when ORACLE_PUBLIC_KEY is not configured', () => {
    process.env.ORACLE_PUBLIC_KEY = '';
    // Create a fresh guard instance so it picks up the empty env var
    const unconfiguredGuard = new OracleGuard();
    const ts = String(Date.now());
    const sig = sign(keypair, ts, body);
    const ctx = makeContext({ 'x-oracle-signature': sig, 'x-oracle-timestamp': ts }, body);
    expect(() => unconfiguredGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
