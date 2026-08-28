import { Test, TestingModule } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import * as jwt from 'jsonwebtoken';
import { AuthService, parseExpirySeconds } from './auth.service';
import { TokenFamilyService } from './token-family.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { SecretsRefreshService } from '../key-rotation/secrets-refresh.service';
import { PrismaService } from '../prisma.service';
import { RedisService } from '../redis.service';

// Prevent @prisma/client from being loaded (generated types not available in CI)
jest.mock('../prisma.service');
jest.mock('@prisma/client', () => ({
  PrismaClient: class {
    user = { upsert: jest.fn(), findUnique: jest.fn() };
    $use = jest.fn();
    $connect = jest.fn();
    $disconnect = jest.fn();
  },
}));

const TEST_SECRET = 'test-secret';

// â”€â”€ Minimal stubs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const prismaMock = {
  user: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
};

/** In-memory Redis stub (same as used in token-family.service.spec.ts). */
class RedisStub {
  private store = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }

  async set(key: string, value: unknown, _ttl: number): Promise<boolean> {
    this.store.set(key, value);
    return true;
  }

  async del(...keys: string[]): Promise<boolean> {
    keys.forEach((k) => this.store.delete(k));
    return true;
  }

  clear() {
    this.store.clear();
  }
}

// â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('AuthService (with token family rotation)', () => {
  let service: AuthService;
  let jwtService: JwtService;
  let keypair: StellarSdk.Keypair;
  let redisStub: RedisStub;

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_REFRESH_SECRET = TEST_SECRET;
    process.env.JWT_ISSUER = 'carbonledger';
    process.env.HMAC_SECRET = 'test-hmac-secret';

    redisStub = new RedisStub();
    keypair = StellarSdk.Keypair.random();

    prismaMock.user.upsert.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });
    prismaMock.user.findFirst.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });
    prismaMock.user.findUnique.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { expiresIn: '15m', issuer: 'carbonledger' },
        }),
      ],
      providers: [
        AuthService,
        TokenFamilyService,
        TokenBlacklistService,
        {
          provide: SecretsRefreshService,
          useValue: {
            getJwtSigningSecret: () => TEST_SECRET,
            getJwtVerificationSecrets: () => [TEST_SECRET],
          },
        },
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisStub },
      ],
    }).compile();

    service = module.get(AuthService);
    jwtService = module.get(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    redisStub.clear();
  });

  // â”€â”€ Helper: full login flow â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function login() {
    const { nonce } = service.generateChallenge(keypair.publicKey());
    const message = `carbonledger:${nonce}`;
    const sig = keypair.sign(Buffer.from(message, 'utf8')).toString('hex');
    return service.verifySignatureAndLogin(keypair.publicKey(), sig, nonce);
  }

  // â”€â”€ generateChallenge â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('generateChallenge', () => {
    it('returns a 64-char hex nonce and future expiry for a valid public key', () => {
      const { nonce, expiresAt } = service.generateChallenge(keypair.publicKey());
      expect(nonce).toHaveLength(64);
      expect(expiresAt).toBeGreaterThan(Date.now());
    });

    it('throws BadRequestException for an invalid public key', () => {
      expect(() => service.generateChallenge('not-a-key')).toThrow(BadRequestException);
    });
  });

  // â”€â”€ verifySignatureAndLogin â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('verifySignatureAndLogin', () => {
    it('returns a JWT access token and an opaque refresh token on valid signature', async () => {
      const { access_token, refresh_token } = await login();

      // access_token must be a valid JWT
      const decoded = jwtService.verify(access_token, { secret: TEST_SECRET }) as any;
      expect(decoded.type).toBe('access');
      expect(decoded.sub).toBe(keypair.publicKey());

      // refresh_token is an opaque string â€” not a JWT
      expect(() => jwtService.verify(refresh_token, { secret: TEST_SECRET })).toThrow();
      // It should be in `<uuid>.<base64url>` format
      expect(refresh_token).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\./,
      );
    });

    it('rejects a wrong signature', async () => {
      const { nonce } = service.generateChallenge(keypair.publicKey());
      const badSig = Buffer.alloc(64).toString('hex');
      await expect(
        service.verifySignatureAndLogin(keypair.publicKey(), badSig, nonce),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a replayed nonce', async () => {
      const { nonce } = service.generateChallenge(keypair.publicKey());
      const sig = keypair
        .sign(Buffer.from(`carbonledger:${nonce}`, 'utf8'))
        .toString('hex');
      await service.verifySignatureAndLogin(keypair.publicKey(), sig, nonce);
      await expect(
        service.verifySignatureAndLogin(keypair.publicKey(), sig, nonce),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  // â”€â”€ refresh â€” normal rotation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('refresh', () => {
    it('issues a new access token and a new refresh token on valid rotation', async () => {
      const { access_token: at1, refresh_token: rt1 } = await login();
      const { access_token: at2, refresh_token: rt2 } = await service.refresh(rt1);

      // Both are non-empty strings
      expect(at2).toBeTruthy();
      expect(rt2).toBeTruthy();

      // Refresh token must be a new opaque string
      expect(rt2).not.toBe(rt1);
      // Access token must still be a valid signed JWT
      expect(() => jwtService.verify(at2, { secret: TEST_SECRET })).not.toThrow();
    });

    it('new access token is a valid JWT for the same user', async () => {
      const { refresh_token } = await login();
      const { access_token } = await service.refresh(refresh_token);
      const decoded = jwtService.verify(access_token, { secret: TEST_SECRET }) as any;
      expect(decoded.sub).toBe(keypair.publicKey());
      expect(decoded.type).toBe('access');
    });

    it('the old refresh token is invalidated after rotation', async () => {
      const { refresh_token: rt1 } = await login();
      await service.refresh(rt1);

      // rt1 is now retired â€” using it again should trigger reuse detection
      await expect(service.refresh(rt1)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a garbage string as a refresh token', async () => {
      await expect(service.refresh('garbage.token.value')).rejects.toThrow(UnauthorizedException);
    });
  });

  // â”€â”€ refresh â€” reuse detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('refresh â€” reuse detection (token theft mitigation)', () => {
    it('invalidates the entire family when a retired token is presented', async () => {
      const { refresh_token: rt1 } = await login();
      const { refresh_token: rt2 } = await service.refresh(rt1); // rt1 is now retired

      // Attacker presents the stolen rt1
      await expect(service.refresh(rt1)).rejects.toThrow(UnauthorizedException);

      // rt2 (the legitimate user's current token) must ALSO be dead now
      await expect(service.refresh(rt2)).rejects.toThrow(UnauthorizedException);
    });

    it('reuse detection error message hints at compromise', async () => {
      const { refresh_token: rt1 } = await login();
      await service.refresh(rt1);

      const err = await service.refresh(rt1).catch((e) => e);
      expect(err).toBeInstanceOf(UnauthorizedException);
      expect(err.message).toMatch(/reuse detected/i);
    });
  });

  // â”€â”€ logout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  describe('logout', () => {
    it('returns a success message', async () => {
      const { refresh_token } = await login();
      const result = await service.logout(refresh_token);
      expect(result.message).toMatch(/logged out/i);
    });

    it('invalidates the family: refresh token no longer works after logout', async () => {
      const { refresh_token } = await login();
      await service.logout(refresh_token);

      await expect(service.refresh(refresh_token)).rejects.toThrow(UnauthorizedException);
    });

  it('does not throw when called with a malformed / already-expired token', async () => {
    await expect(service.logout('not-a-valid-token')).resolves.not.toThrow();
  });

  it('blacklists the access token jti so guards reject it immediately (#892)', async () => {
    const { access_token, refresh_token } = await login();
    await service.logout(refresh_token, access_token);

    const decoded: any = jwtService.decode(access_token) as any;
    const blacklist = (service as any).tokenBlacklist as TokenBlacklistService;
    expect(await blacklist.isRevoked(decoded.jti)).toBe(true);
  });

  it('leaves the access token usable when logout is called without it', async () => {
    const { access_token, refresh_token } = await login();
    await service.logout(refresh_token);

    const decoded: any = jwtService.decode(access_token) as any;
    const blacklist = (service as any).tokenBlacklist as TokenBlacklistService;
    expect(await blacklist.isRevoked(decoded.jti)).toBe(false);
  });
});

describe('#892 â€” strict 15-minute access-token lifetime', () => {
  let service: AuthService;
  let keypair: StellarSdk.Keypair;
  let redisStub: RedisStub;

  beforeEach(async () => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_ISSUER = 'carbonledger';
    process.env.HMAC_SECRET = 'test-hmac-secret';

    redisStub = new RedisStub();
    keypair = StellarSdk.Keypair.random();

    prismaMock.user.upsert.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });
    prismaMock.user.findFirst.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });
    prismaMock.user.findUnique.mockResolvedValue({
      publicKey: keypair.publicKey(),
      role: 'corporation',
    });
  });

  afterEach(() => {
    delete process.env.JWT_EXPIRY;
    jest.clearAllMocks();
    redisStub.clear();
  });

  async function buildAndLogin(): Promise<{ access_token: string }> {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: TEST_SECRET,
          signOptions: { expiresIn: '15m', issuer: 'carbonledger' },
        }),
      ],
      providers: [
        AuthService,
        TokenFamilyService,
        TokenBlacklistService,
        {
          provide: SecretsRefreshService,
          useValue: {
            getJwtSigningSecret: () => TEST_SECRET,
            getJwtVerificationSecrets: () => [TEST_SECRET],
          },
        },
        { provide: PrismaService, useValue: prismaMock },
        { provide: RedisService, useValue: redisStub },
      ],
    }).compile();

    const svc = module.get(AuthService);
    const { nonce } = svc.generateChallenge(keypair.publicKey());
    const message = `carbonledger:${nonce}`;
    const sig = keypair.sign(Buffer.from(message, 'utf8')).toString('hex');
    return svc.verifySignatureAndLogin(keypair.publicKey(), sig, nonce);
  }

  it('default expiry is at most 15 minutes and tokens carry a jti', async () => {
    delete process.env.JWT_EXPIRY;
    const { access_token } = await buildAndLogin();
    const decoded: any = jwt.verify(access_token, TEST_SECRET);
    expect(decoded.jti).toBeTruthy();
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(15 * 60);
  });

  it('clamps an over-long configured JWT_EXPIRY down to 15 minutes', async () => {
    process.env.JWT_EXPIRY = '7d';
    const { access_token } = await buildAndLogin();
    const decoded: any = jwt.verify(access_token, TEST_SECRET);
    expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(15 * 60);
  });

  it('parseExpirySeconds handles s/m/h/d units and garbage input', () => {
    expect(parseExpirySeconds('30s')).toBe(30);
    expect(parseExpirySeconds('15m')).toBe(900);
    expect(parseExpirySeconds('1h')).toBe(3600);
    expect(parseExpirySeconds('2d')).toBe(172800);
    expect(parseExpirySeconds('nonsense')).toBe(900);
  });
});
});
