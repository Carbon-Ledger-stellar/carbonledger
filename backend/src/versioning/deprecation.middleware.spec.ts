import { DeprecationMiddleware, API_DEPRECATION_DATES } from './deprecation.middleware';

/**
 * Tests for DeprecationMiddleware.
 *
 * Verifies that:
 * 1. v1 routes receive RFC 8594 Deprecation + Sunset headers
 * 2. v2 routes receive only the version header (no deprecation)
 * 3. Non-versioned routes are unaffected
 * 4. The successor-version Link header points to v2
 */
describe('DeprecationMiddleware', () => {
  let middleware: DeprecationMiddleware;

  // Minimal mock of express Request / Response / NextFunction
  function makeReq(path: string): any {
    return {
      path,
      protocol: 'https',
      get: (name: string) => (name === 'host' ? 'api.carbonledger.io' : undefined),
    };
  }

  function makeRes() {
    const headers: Record<string, string> = {};
    return {
      headers,
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      getHeader(name: string) {
        return headers[name];
      },
    };
  }

  beforeEach(() => {
    middleware = new DeprecationMiddleware();
  });

  // ── v1 deprecation headers ─────────────────────────────────────────────

  describe('v1 routes', () => {
    it('sets Deprecation: true', () => {
      const req = makeReq('/api/v1/credits/batch/123');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['Deprecation']).toBe('true');
    });

    it('sets Sunset header matching configured deprecation date', () => {
      const req = makeReq('/api/v1/marketplace/listings');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      const expected = API_DEPRECATION_DATES.v1.toUTCString();
      expect(res.headers['Sunset']).toBe(expected);
    });

    it('sets Link header with successor-version pointing to v2', () => {
      const req = makeReq('/api/v1/projects');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['Link']).toContain('rel="successor-version"');
      expect(res.headers['Link']).toContain('/api/v2/projects');
    });

    it('sets Link header with deprecation docs', () => {
      const req = makeReq('/api/v1/credits/mint');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['Link']).toContain('rel="deprecation"');
    });

    it('sets X-API-Deprecated: true', () => {
      const req = makeReq('/api/v1/retirements');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['X-API-Deprecated']).toBe('true');
    });

    it('sets X-API-Migration-Guide header', () => {
      const req = makeReq('/api/v1/retirements');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['X-API-Migration-Guide']).toContain('migration');
    });

    it('sets X-API-Version: 1', () => {
      const req = makeReq('/api/v1/oracle/status/proj-1');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['X-API-Version']).toBe('1');
    });

    it('calls next()', () => {
      const req = makeReq('/api/v1/health');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── v2 routes ─────────────────────────────────────────────────────────

  describe('v2 routes', () => {
    it('does NOT set Deprecation header', () => {
      const req = makeReq('/api/v2/credits/batch/123');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['Deprecation']).toBeUndefined();
    });

    it('does NOT set Sunset header', () => {
      const req = makeReq('/api/v2/marketplace/listings');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['Sunset']).toBeUndefined();
    });

    it('sets X-API-Version: 2', () => {
      const req = makeReq('/api/v2/projects');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['X-API-Version']).toBe('2');
    });

    it('calls next()', () => {
      const req = makeReq('/api/v2/retirements');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Non-versioned routes ──────────────────────────────────────────────

  describe('non-versioned routes', () => {
    it('does not set any version headers for /health', () => {
      const req = makeReq('/health');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(res.headers['Deprecation']).toBeUndefined();
      expect(res.headers['X-API-Version']).toBeUndefined();
    });

    it('calls next() for non-versioned routes', () => {
      const req = makeReq('/docs');
      const res = makeRes();
      const next = jest.fn();

      middleware.use(req as any, res as any, next);

      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  // ── Sunset date sanity ────────────────────────────────────────────────

  describe('deprecation configuration', () => {
    it('v1 sunset date is in the future', () => {
      expect(API_DEPRECATION_DATES.v1.getTime()).toBeGreaterThan(Date.now());
    });

    it('v1 sunset date is after 2026', () => {
      expect(API_DEPRECATION_DATES.v1.getFullYear()).toBeGreaterThanOrEqual(2027);
    });
  });
});
