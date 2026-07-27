/**
 * Tests for CorrelationIdContext (AsyncLocalStorage wrapper).
 *
 * Covers:
 *  - Context isolation between concurrent async operations
 *  - enrichContext() merges fields without replacing the store
 *  - getCorrelationId() returns empty string when no context is set
 *  - Correlation ID threads through Promise chains correctly
 */

import { CorrelationIdContext } from './correlation-id.context';

describe('CorrelationIdContext', () => {
  describe('generateCorrelationId()', () => {
    it('generates a valid UUID v4', () => {
      const id = CorrelationIdContext.generateCorrelationId();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('generates a unique ID on each call', () => {
      const ids = new Set(Array.from({ length: 20 }, () => CorrelationIdContext.generateCorrelationId()));
      expect(ids.size).toBe(20);
    });
  });

  describe('setContext() / getContext()', () => {
    it('returns the stored context', () => {
      CorrelationIdContext.run({ correlationId: 'stored-ctx' }, () => {
        CorrelationIdContext.setContext({ correlationId: 'stored-ctx', method: 'GET', path: '/health' });
        const ctx = CorrelationIdContext.getContext();
        expect(ctx?.correlationId).toBe('stored-ctx');
        expect(ctx?.method).toBe('GET');
        expect(ctx?.path).toBe('/health');
      });
    });

    it('returns undefined when no context is active', () => {
      // Run outside any existing async context
      expect(CorrelationIdContext.getContext()).toBeUndefined();
    });
  });

  describe('getCorrelationId()', () => {
    it('returns the correlationId from the active context', () => {
      CorrelationIdContext.run({ correlationId: 'get-id-test' }, () => {
        expect(CorrelationIdContext.getCorrelationId()).toBe('get-id-test');
      });
    });

    it('returns empty string when no context is set', () => {
      // Calling outside any run() context
      expect(CorrelationIdContext.getCorrelationId()).toBe('');
    });
  });

  describe('enrichContext()', () => {
    it('adds new fields to the existing context', () => {
      CorrelationIdContext.run({ correlationId: 'enrich-me' }, () => {
        CorrelationIdContext.enrichContext({ actor: 'GABC', role: 'admin' });
        const ctx = CorrelationIdContext.getContext();
        expect(ctx?.correlationId).toBe('enrich-me');
        expect(ctx?.actor).toBe('GABC');
        expect(ctx?.role).toBe('admin');
      });
    });

    it('overwrites existing fields with new values', () => {
      CorrelationIdContext.run(
        { correlationId: 'overwrite', statusCode: 200 },
        () => {
          CorrelationIdContext.enrichContext({ statusCode: 404 });
          const ctx = CorrelationIdContext.getContext();
          expect(ctx?.statusCode).toBe(404);
          // correlationId should be unchanged
          expect(ctx?.correlationId).toBe('overwrite');
        },
      );
    });

    it('is a no-op when no context is active', () => {
      // Should not throw
      expect(() => CorrelationIdContext.enrichContext({ actor: 'GABC' })).not.toThrow();
    });
  });

  describe('run() — context isolation', () => {
    it('isolates context between two concurrent run() calls', async () => {
      const results: string[] = [];

      await Promise.all([
        new Promise<void>((resolve) => {
          CorrelationIdContext.run({ correlationId: 'corr-A' }, async () => {
            await new Promise((r) => setTimeout(r, 10));
            results.push(`A:${CorrelationIdContext.getCorrelationId()}`);
            resolve();
          });
        }),
        new Promise<void>((resolve) => {
          CorrelationIdContext.run({ correlationId: 'corr-B' }, async () => {
            await new Promise((r) => setTimeout(r, 5));
            results.push(`B:${CorrelationIdContext.getCorrelationId()}`);
            resolve();
          });
        }),
      ]);

      // Each context should have seen its own correlationId
      expect(results).toContain('A:corr-A');
      expect(results).toContain('B:corr-B');
    });

    it('threads correlationId through a Promise chain', async () => {
      const ids: string[] = [];

      await new Promise<void>((resolve) => {
        CorrelationIdContext.run({ correlationId: 'chain-id' }, async () => {
          ids.push(CorrelationIdContext.getCorrelationId()); // step 1
          await Promise.resolve();
          ids.push(CorrelationIdContext.getCorrelationId()); // step 2
          await new Promise((r) => setTimeout(r, 1));
          ids.push(CorrelationIdContext.getCorrelationId()); // step 3
          resolve();
        });
      });

      expect(ids).toEqual(['chain-id', 'chain-id', 'chain-id']);
    });

    it('outer context is restored after inner run() completes', () => {
      CorrelationIdContext.run({ correlationId: 'outer' }, () => {
        CorrelationIdContext.run({ correlationId: 'inner' }, () => {
          expect(CorrelationIdContext.getCorrelationId()).toBe('inner');
        });
        // After inner run, we should see outer again
        // Note: AsyncLocalStorage.run() restores the previous store automatically
        expect(CorrelationIdContext.getCorrelationId()).toBe('outer');
      });
    });
  });
});
