import { RedisService } from './redis.service';
import { BLACKLIST_KEY_PREFIX } from './auth/token-blacklist.service';

/**
 * Regression coverage for RedisService's key allowlist.
 *
 * `normalizeRedisKey` rejects any key whose prefix isn't in
 * `ALLOWED_REDIS_KEY_PREFIXES`, and `get`/`set`/`del` swallow that
 * rejection internally (returning null/false rather than throwing) so
 * callers degrade gracefully on a genuine Redis outage. That same
 * swallowing means a key prefix simply missing from the allowlist fails
 * silently too — every write and read looks like "Redis is down" instead
 * of "this key was rejected". `TokenBlacklistService` shipped using
 * `auth:bl:` while the allowlist only had `auth:family:`, so every
 * blacklist write/read silently no-opped against a real Redis instance
 * even though every *mocked* unit test passed. This suite exercises the
 * real class (not a mock) so that gap can't reopen unnoticed.
 */
describe('RedisService — key allowlist', () => {
  function makeConnectedService(): { service: RedisService; client: { set: jest.Mock; get: jest.Mock; del: jest.Mock } } {
    const service = new RedisService();
    const client = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      del: jest.fn().mockResolvedValue(1),
    };
    (service as any).client = client;
    (service as any).connected = true;
    return { service, client };
  }

  it('accepts the auth:bl: prefix used by TokenBlacklistService', async () => {
    const { service, client } = makeConnectedService();

    const ok = await service.set(`${BLACKLIST_KEY_PREFIX}some-jti`, true, 60);

    expect(ok).toBe(true);
    expect(client.set).toHaveBeenCalledWith(
      `${BLACKLIST_KEY_PREFIX}some-jti`,
      JSON.stringify(true),
      'EX',
      60,
    );
  });

  it('accepts the auth:family: prefix used by TokenFamilyService', async () => {
    const { service, client } = makeConnectedService();

    const ok = await service.set('auth:family:some-id', { userId: 'x' }, 60);

    expect(ok).toBe(true);
    expect(client.set).toHaveBeenCalled();
  });

  it('rejects an arbitrary unregistered prefix instead of silently no-op-ing forever', async () => {
    const { service } = makeConnectedService();
    const ok = await service.set('not-an-allowed-prefix:x', true, 60);
    expect(ok).toBe(false);
  });
});
