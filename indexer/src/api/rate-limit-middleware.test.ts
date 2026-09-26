/**
 * Tests for tiered rate limiting, API key management, and IP blocking.
 *
 * Uses in-memory Redis mock via a simple Map-based stub so tests run without
 * a real Redis instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Redis stub ───────────────────────────────────────────────────────────────

class RedisStub {
  private sets: Map<string, Set<string>> = new Map();
  private strings: Map<string, { value: string; expireAt?: number }> = new Map();
  private counters: Map<string, number> = new Map();

  async sismember(key: string, member: string): Promise<number> {
    return this.sets.get(key)?.has(member) ? 1 : 0;
  }
  async sadd(key: string, ...members: string[]): Promise<number> {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    const s = this.sets.get(key)!;
    let added = 0;
    for (const m of members) {
      if (!s.has(m)) { s.add(m); added++; }
    }
    return added;
  }
  async srem(key: string, ...members: string[]): Promise<number> {
    const s = this.sets.get(key);
    if (!s) return 0;
    let removed = 0;
    for (const m of members) {
      if (s.delete(m)) removed++;
    }
    return removed;
  }
  async smembers(key: string): Promise<string[]> {
    return Array.from(this.sets.get(key) ?? []);
  }
  async incr(key: string): Promise<number> {
    const val = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, val);
    return val;
  }
  async expire(_key: string, _seconds: number): Promise<number> { return 1; }
  async set(key: string, value: string, _ex?: string, _ttl?: number): Promise<'OK'> {
    this.strings.set(key, { value });
    return 'OK';
  }
  async exists(key: string): Promise<number> {
    return this.strings.has(key) ? 1 : 0;
  }
  async del(key: string): Promise<number> {
    const deleted = (this.strings.delete(key) ? 1 : 0) + (this.counters.delete(key) ? 1 : 0);
    return deleted;
  }
  async quit() {}
  on() {}
  reset() {
    this.sets.clear();
    this.strings.clear();
    this.counters.clear();
  }
}

const redisStub = new RedisStub();

// Inject stub before importing the module under test
vi.mock('../redis-client', () => ({
  getRedisClient: () => redisStub,
  setRedisClient: vi.fn(),
  closeRedisClient: vi.fn(),
}));

// Import after mock
import {
  isApiKeyValid,
  isIpBlocked,
  recordViolation,
  blockIp,
  VIOLATION_THRESHOLD,
  BLOCK_DURATION_SECONDS,
  BLOCKED_IPS_KEY,
  API_KEYS_SET_KEY,
  VIOLATION_PREFIX,
  blocklistMiddleware,
  adminAuthMiddleware,
  addApiKey,
  deleteApiKey,
  listApiKeys,
  unblockIp,
  getClientIp,
  isInternalRequest,
} from './rate-limit-middleware';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    socket: { remoteAddress: '10.0.0.1' },
    body: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const set = vi.fn().mockReturnThis();
  const status = vi.fn().mockReturnValue({ json });
  const res = { status, json, set } as unknown as Response;
  return { res, status, json, set };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  redisStub.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ── getClientIp ───────────────────────────────────────────────────────────────

describe('getClientIp', () => {
  it('returns the first IP from X-Forwarded-For', () => {
    const req = makeReq({ headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' } });
    expect(getClientIp(req)).toBe('203.0.113.1');
  });

  it('returns socket remoteAddress when no forwarded header', () => {
    const req = makeReq({ headers: {} });
    expect(getClientIp(req)).toBe('10.0.0.1');
  });
});

// ── isInternalRequest ─────────────────────────────────────────────────────────

describe('isInternalRequest', () => {
  it('identifies localhost IPv4 as internal', () => {
    expect(isInternalRequest('127.0.0.1')).toBe(true);
  });
  it('identifies ::1 as internal', () => {
    expect(isInternalRequest('::1')).toBe(true);
  });
  it('identifies external IP as non-internal', () => {
    expect(isInternalRequest('203.0.113.5')).toBe(false);
  });
});

// ── isApiKeyValid ─────────────────────────────────────────────────────────────

describe('isApiKeyValid', () => {
  it('returns false when no API keys exist', async () => {
    expect(await isApiKeyValid('some-key')).toBe(false);
  });

  it('returns true for a key that has been added', async () => {
    await redisStub.sadd(API_KEYS_SET_KEY, 'valid-key-123');
    expect(await isApiKeyValid('valid-key-123')).toBe(true);
  });

  it('returns false for a key that was not added', async () => {
    await redisStub.sadd(API_KEYS_SET_KEY, 'other-key');
    expect(await isApiKeyValid('not-this-key')).toBe(false);
  });
});

// ── isIpBlocked ───────────────────────────────────────────────────────────────

describe('isIpBlocked', () => {
  it('returns false when IP is not blocked', async () => {
    expect(await isIpBlocked('10.0.0.5')).toBe(false);
  });

  it('returns true when IP is in the blocklist', async () => {
    await redisStub.sadd(BLOCKED_IPS_KEY, '10.0.0.5');
    expect(await isIpBlocked('10.0.0.5')).toBe(true);
  });
});

// ── recordViolation / blockIp ─────────────────────────────────────────────────

describe('recordViolation', () => {
  it('increments violation count', async () => {
    const count1 = await recordViolation('1.2.3.4');
    const count2 = await recordViolation('1.2.3.4');
    expect(count1).toBe(1);
    expect(count2).toBe(2);
  });

  it('returns independent counts for different IPs', async () => {
    const c1 = await recordViolation('1.1.1.1');
    const c2 = await recordViolation('2.2.2.2');
    expect(c1).toBe(1);
    expect(c2).toBe(1);
  });
});

describe('blockIp', () => {
  it('adds IP to the blocklist set', async () => {
    await blockIp('9.9.9.9');
    expect(await isIpBlocked('9.9.9.9')).toBe(true);
  });

  it('sets a TTL key for auto-unblock', async () => {
    await blockIp('9.9.9.9');
    const exists = await redisStub.exists(`blocked_ip_ttl:9.9.9.9`);
    expect(exists).toBe(1);
  });
});

// ── Auto-blocking after VIOLATION_THRESHOLD ────────────────────────────────────

describe('auto-blocking threshold', () => {
  it('VIOLATION_THRESHOLD is 10', () => {
    expect(VIOLATION_THRESHOLD).toBe(10);
  });

  it('BLOCK_DURATION_SECONDS is 3600', () => {
    expect(BLOCK_DURATION_SECONDS).toBe(3600);
  });

  it('blocks IP after threshold violations', async () => {
    const ip = '5.5.5.5';
    for (let i = 0; i < VIOLATION_THRESHOLD; i++) {
      await recordViolation(ip);
    }
    // Manually block as the rate limiter handler would
    await blockIp(ip);
    expect(await isIpBlocked(ip)).toBe(true);
  });
});

// ── blocklistMiddleware ────────────────────────────────────────────────────────

describe('blocklistMiddleware', () => {
  it('passes through non-blocked IPs', async () => {
    const req = makeReq();
    const { res, status } = makeRes();
    const next = vi.fn();
    await blocklistMiddleware(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns 429 for blocked IPs', async () => {
    await redisStub.sadd(BLOCKED_IPS_KEY, '10.0.0.1');
    await redisStub.set('blocked_ip_ttl:10.0.0.1', '1');

    const req = makeReq();
    const { res, status, json, set } = makeRes();
    const next = vi.fn();
    await blocklistMiddleware(req, res, next as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Too Many Requests' }));
  });

  it('passes through internal IPs even if somehow added to blocklist', async () => {
    await redisStub.sadd(BLOCKED_IPS_KEY, '127.0.0.1');
    const req = makeReq({ socket: { remoteAddress: '127.0.0.1' } as any });
    const { res, status } = makeRes();
    const next = vi.fn();
    await blocklistMiddleware(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('auto-unblocks IP when TTL key has expired', async () => {
    await redisStub.sadd(BLOCKED_IPS_KEY, '10.0.0.1');
    // No TTL key — simulates expired block

    const req = makeReq();
    const { res, status } = makeRes();
    const next = vi.fn();
    await blocklistMiddleware(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
    // IP should have been removed from blocklist
    expect(await isIpBlocked('10.0.0.1')).toBe(false);
  });
});

// ── adminAuthMiddleware ────────────────────────────────────────────────────────

describe('adminAuthMiddleware', () => {
  const originalToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test-admin-secret';
  });
  afterEach(() => {
    process.env.ADMIN_TOKEN = originalToken;
  });

  it('passes through requests with valid Bearer token', () => {
    const req = makeReq({ headers: { authorization: 'Bearer test-admin-secret' } });
    const { res } = makeRes();
    const next = vi.fn();
    adminAuthMiddleware(req, res, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 for wrong token', () => {
    const req = makeReq({ headers: { authorization: 'Bearer wrong' } });
    const { res, status, json } = makeRes();
    const next = vi.fn();
    adminAuthMiddleware(req, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Unauthorized' }));
  });

  it('returns 503 when ADMIN_TOKEN is not configured', () => {
    delete process.env.ADMIN_TOKEN;
    const req = makeReq({ headers: { authorization: 'Bearer anything' } });
    const { res, status } = makeRes();
    const next = vi.fn();
    adminAuthMiddleware(req, res, next as NextFunction);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(503);
  });
});

// ── Admin API key endpoints ────────────────────────────────────────────────────

describe('addApiKey', () => {
  it('adds a key and returns 201', async () => {
    const req = makeReq({ body: { key: 'new-api-key-abc' } });
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    await addApiKey(req, res);
    expect(status).toHaveBeenCalledWith(201);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ key: 'new-api-key-abc' }));
    expect(await isApiKeyValid('new-api-key-abc')).toBe(true);
  });

  it('returns 400 for missing key', async () => {
    const req = makeReq({ body: {} });
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    await addApiKey(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });
});

describe('deleteApiKey', () => {
  it('removes an existing key', async () => {
    await redisStub.sadd(API_KEYS_SET_KEY, 'to-delete');
    const req = makeReq({ params: { key: 'to-delete' } });
    const json = vi.fn();
    const res = { json, status: vi.fn().mockReturnValue({ json }) } as unknown as Response;
    await deleteApiKey(req, res);
    expect(await isApiKeyValid('to-delete')).toBe(false);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ key: 'to-delete' }));
  });

  it('returns 404 for non-existent key', async () => {
    const req = makeReq({ params: { key: 'ghost' } });
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    await deleteApiKey(req, res);
    expect(status).toHaveBeenCalledWith(404);
  });
});

describe('listApiKeys', () => {
  it('returns empty list when no keys exist', async () => {
    const req = makeReq();
    const json = vi.fn();
    const res = { json } as unknown as Response;
    await listApiKeys(req, res);
    expect(json).toHaveBeenCalledWith({ keys: [] });
  });

  it('returns all keys', async () => {
    await redisStub.sadd(API_KEYS_SET_KEY, 'key-a', 'key-b');
    const req = makeReq();
    const json = vi.fn();
    const res = { json } as unknown as Response;
    await listApiKeys(req, res);
    const call = (json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.keys).toContain('key-a');
    expect(call.keys).toContain('key-b');
  });
});

describe('unblockIp', () => {
  it('unblocks a blocked IP', async () => {
    await blockIp('7.7.7.7');
    const req = makeReq({ body: { ip: '7.7.7.7' } });
    const json = vi.fn();
    const res = { json } as unknown as Response;
    await unblockIp(req, res);
    expect(await isIpBlocked('7.7.7.7')).toBe(false);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ ip: '7.7.7.7' }));
  });

  it('returns 400 for missing ip', async () => {
    const req = makeReq({ body: {} });
    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    const res = { status, json } as unknown as Response;
    await unblockIp(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });
});
