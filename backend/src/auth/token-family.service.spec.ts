import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { TokenFamilyService, TokenFamily } from './token-family.service';
import { RedisService } from '../redis.service';

// ── In-memory Redis stub ──────────────────────────────────────────────────────
class RedisStub {
  private store = new Map<string, { value: unknown; ttl: number; setAt: number }>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    const elapsed = (Date.now() - entry.setAt) / 1000;
    if (elapsed > entry.ttl) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<boolean> {
    this.store.set(key, { value, ttl: ttlSeconds, setAt: Date.now() });
    return true;
  }

  async del(...keys: string[]): Promise<boolean> {
    keys.forEach((k) => this.store.delete(k));
    return true;
  }

  /** Test helper — check whether a key currently exists. */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /** Test helper — clear everything. */
  clear() {
    this.store.clear();
  }
}

// ── Test suite ────────────────────────────────────────────────────────────────
describe('TokenFamilyService', () => {
  let service: TokenFamilyService;
  let redisMock: RedisStub;

  const TEST_USER = 'GABC1234TEST_STELLAR_PUBLIC_KEY';

  beforeEach(async () => {
    process.env.HMAC_SECRET = 'test-hmac-secret';

    redisMock = new RedisStub();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TokenFamilyService,
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    service = module.get(TokenFamilyService);
  });

  afterEach(() => {
    redisMock.clear();
    jest.restoreAllMocks();
  });

  // ── createFamily ────────────────────────────────────────────────────────────

  describe('createFamily', () => {
    it('creates a family record in Redis with correct initial shape', async () => {
      const { familyId, rawToken } = await service.createFamily(TEST_USER);

      expect(typeof familyId).toBe('string');
      expect(typeof rawToken).toBe('string');
      // Token must embed the familyId as the first segment
      expect(rawToken.startsWith(`${familyId}.`)).toBe(true);

      const family = await redisMock.get<TokenFamily>(`auth:family:${familyId}`);
      expect(family).not.toBeNull();
      expect(family!.userId).toBe(TEST_USER);
      expect(family!.tokens).toHaveLength(1);
      expect(family!.tokens[0]).toBe(service.hashToken(rawToken));
      expect(family!.activeTokenHash).toBe(service.hashToken(rawToken));
    });

    it('stores the HMAC hash — not the raw token — in Redis', async () => {
      const { familyId, rawToken } = await service.createFamily(TEST_USER);
      const family = await redisMock.get<TokenFamily>(`auth:family:${familyId}`);
      // None of the stored token entries should equal the raw token
      expect(family!.tokens).not.toContain(rawToken);
      expect(family!.activeTokenHash).not.toBe(rawToken);
    });
  });

  // ── rotateToken (happy path) ─────────────────────────────────────────────────

  describe('rotateToken — happy path', () => {
    it('issues a new raw token and retires the old one', async () => {
      const { rawToken: firstToken } = await service.createFamily(TEST_USER);

      const { newRawToken, userId } = await service.rotateToken(firstToken);

      expect(newRawToken).not.toBe(firstToken);
      expect(userId).toBe(TEST_USER);
    });

    it('new token embeds the same familyId', async () => {
      const { familyId, rawToken } = await service.createFamily(TEST_USER);
      const { newRawToken } = await service.rotateToken(rawToken);
      expect(newRawToken.startsWith(`${familyId}.`)).toBe(true);
    });

    it('accumulates hashes: family.tokens grows by one after each rotation', async () => {
      const { familyId, rawToken: t1 } = await service.createFamily(TEST_USER);

      const { newRawToken: t2 } = await service.rotateToken(t1);
      let family = await redisMock.get<TokenFamily>(`auth:family:${familyId}`);
      expect(family!.tokens).toHaveLength(2);

      await service.rotateToken(t2);
      family = await redisMock.get<TokenFamily>(`auth:family:${familyId}`);
      expect(family!.tokens).toHaveLength(3);
    });

    it('updates lastUsedAt on rotation', async () => {
      const { familyId, rawToken } = await service.createFamily(TEST_USER);
      const familyBefore = await redisMock.get<TokenFamily>(`auth:family:${familyId}`);

      // Advance time slightly
      await new Promise((r) => setTimeout(r, 5));
      await service.rotateToken(rawToken);

      const familyAfter = await redisMock.get<TokenFamily>(`auth:family:${familyId}`);
      expect(familyAfter!.lastUsedAt).toBeGreaterThanOrEqual(familyBefore!.lastUsedAt);
    });
  });

  // ── rotateToken — reuse detection ────────────────────────────────────────────

  describe('rotateToken — reuse detection', () => {
    it('throws UnauthorizedException when a previously-used token is presented again', async () => {
      const { rawToken: firstToken } = await service.createFamily(TEST_USER);
      // Rotate once — firstToken is now retired
      await service.rotateToken(firstToken);

      // Replaying the retired firstToken must be rejected
      await expect(service.rotateToken(firstToken)).rejects.toThrow(UnauthorizedException);
    });

    it('invalidates the ENTIRE family on reuse detection', async () => {
      const { familyId, rawToken: firstToken } = await service.createFamily(TEST_USER);
      await service.rotateToken(firstToken);

      // Ignore the thrown error — we care about the side-effect
      await service.rotateToken(firstToken).catch(() => undefined);

      const family = await redisMock.get<TokenFamily>(`auth:family:${familyId}`);
      expect(family).toBeNull(); // family deleted from Redis
    });

    it('error message indicates re-login is required on reuse', async () => {
      const { rawToken: firstToken } = await service.createFamily(TEST_USER);
      await service.rotateToken(firstToken);

      const error = await service.rotateToken(firstToken).catch((e) => e);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toMatch(/reuse detected/i);
    });
  });

  // ── rotateToken — invalid / expired token ────────────────────────────────────

  describe('rotateToken — invalid / expired token', () => {
    it('throws UnauthorizedException for a completely unknown token', async () => {
      await expect(service.rotateToken('not-a-valid-token')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws UnauthorizedException when family has been deleted (simulates TTL expiry)', async () => {
      const { familyId, rawToken } = await service.createFamily(TEST_USER);
      // Simulate TTL expiry by deleting from the store directly
      await redisMock.del(`auth:family:${familyId}`);

      await expect(service.rotateToken(rawToken)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a token with valid UUID prefix but wrong hash', async () => {
      const { familyId } = await service.createFamily(TEST_USER);
      const forgery = `${familyId}.aaaabbbbccccddddeeeeffffaaaabbbbccccddddeeeeffffaaaabbbbcccc`;
      await expect(service.rotateToken(forgery)).rejects.toThrow(UnauthorizedException);
    });
  });

  // ── invalidateFamilyByToken (logout) ─────────────────────────────────────────

  describe('invalidateFamilyByToken (logout)', () => {
    it('removes the family from Redis', async () => {
      const { familyId, rawToken } = await service.createFamily(TEST_USER);
      expect(redisMock.has(`auth:family:${familyId}`)).toBe(true);

      await service.invalidateFamilyByToken(rawToken);

      expect(redisMock.has(`auth:family:${familyId}`)).toBe(false);
    });

    it('subsequent rotateToken on the same token throws after logout', async () => {
      const { rawToken } = await service.createFamily(TEST_USER);
      await service.invalidateFamilyByToken(rawToken);

      await expect(service.rotateToken(rawToken)).rejects.toThrow(UnauthorizedException);
    });

    it('does not throw when given a malformed token', async () => {
      await expect(service.invalidateFamilyByToken('garbage')).resolves.not.toThrow();
    });
  });

  // ── invalidateFamily (direct) ─────────────────────────────────────────────────

  describe('invalidateFamily (direct)', () => {
    it('removes the family by ID', async () => {
      const { familyId } = await service.createFamily(TEST_USER);
      await service.invalidateFamily(familyId);
      expect(redisMock.has(`auth:family:${familyId}`)).toBe(false);
    });
  });

  // ── hashToken ─────────────────────────────────────────────────────────────────

  describe('hashToken', () => {
    it('produces deterministic output for the same input', () => {
      const token = 'some-raw-token';
      expect(service.hashToken(token)).toBe(service.hashToken(token));
    });

    it('produces different hashes for different inputs', () => {
      expect(service.hashToken('token-a')).not.toBe(service.hashToken('token-b'));
    });
  });
});
