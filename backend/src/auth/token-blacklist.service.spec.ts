import { TokenBlacklistService, MAX_BLACKLIST_TTL_SECONDS } from './token-blacklist.service';
import { RedisService } from '../redis.service';

describe('TokenBlacklistService (#892)', () => {
  let service: TokenBlacklistService;
  let store: Map<string, unknown>;

  const redisMock = {
    get: jest.fn(async (key: string) => (store.has(key) ? store.get(key) : null)),
    set: jest.fn(async (key: string, value: unknown, _ttl: number) => {
      store.set(key, value);
      return true;
    }),
    del: jest.fn(async (...keys: string[]) => {
      keys.forEach((k) => store.delete(k));
      return true;
    }),
  };

  beforeEach(() => {
    store = new Map();
    jest.clearAllMocks();
    service = new TokenBlacklistService(redisMock as unknown as RedisService);
  });

  it('revokes a jti with the remaining token lifetime', async () => {
    await service.revoke('jti-1', 300);
    expect(redisMock.set).toHaveBeenCalledWith('auth:bl:jti-1', true, 300);
    expect(await service.isRevoked('jti-1')).toBe(true);
  });

  it('clamps the TTL to the 15-minute maximum', async () => {
    await service.revoke('jti-2', 999_999);
    expect(redisMock.set).toHaveBeenCalledWith(
      'auth:bl:jti-2',
      true,
      MAX_BLACKLIST_TTL_SECONDS,
    );
  });

  it('clamps non-positive TTLs up to 1 second', async () => {
    await service.revoke('jti-3', 0);
    expect(redisMock.set).toHaveBeenCalledWith('auth:bl:jti-3', true, 1);
  });

  it('reports unknown jtis as not revoked', async () => {
    expect(await service.isRevoked('never-seen')).toBe(false);
  });

  it('fails open (not revoked) when Redis is unavailable', async () => {
    redisMock.get.mockResolvedValueOnce(null); // RedisService returns null on error
    expect(await service.isRevoked('any-jti')).toBe(false);
  });

  it('returns false when revoke fails (Redis down)', async () => {
    redisMock.set.mockResolvedValueOnce(false);
    expect(await service.revoke('jti-4', 100)).toBe(false);
  });
});
