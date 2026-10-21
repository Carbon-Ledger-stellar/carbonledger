import { ExecutionContext, CallHandler } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { ContractPauseResponseInterceptor } from './contract-pause-response.interceptor';

describe('ContractPauseResponseInterceptor (#1223)', () => {
  function createMockExecutionContext(): { context: ExecutionContext; responseHeaders: Record<string, string> } {
    const responseHeaders: Record<string, string> = {};
    const mockResponse = {
      setHeader: jest.fn((name: string, value: string) => {
        responseHeaders[name] = value;
      }),
    };

    const context = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: () => ({}),
      }),
    } as unknown as ExecutionContext;

    return { context, responseHeaders };
  }

  function createMockPrisma(isPaused: boolean, reason: string | null = null, pausedAt: Date | null = null) {
    return {
      adminConfig: {
        findMany: jest.fn().mockResolvedValue([
          { key: 'carbon_credit_paused', value: String(isPaused) },
          { key: 'carbon_credit_paused_until', value: String(Math.floor(Date.now() / 1000) + 3600) },
          { key: 'carbon_credit_reason', value: reason ?? '' },
        ]),
      },
      contractSyncState: {
        findFirst: jest.fn().mockResolvedValue(
          isPaused
            ? {
                isPaused: true,
                pauseReason: reason,
                pausedUntil: new Date(Date.now() + 3600_000),
                updatedAt: pausedAt ?? new Date(),
              }
            : null,
        ),
      },
      pauseEvent: {
        findFirst: jest.fn().mockResolvedValue(
          isPaused
            ? {
                action: 'pause',
                reason,
                occurredAt: pausedAt ?? new Date('2026-10-19T12:00:00.000Z'),
              }
            : null,
        ),
      },
    } as any;
  }

  it('includes is_paused=false and preserves original response structure when unpaused', async () => {
    const prisma = createMockPrisma(false);
    const interceptor = new ContractPauseResponseInterceptor(prisma);
    const { context, responseHeaders } = createMockExecutionContext();

    const originalData = {
      batchId: 'BATCH-001',
      projectId: 'PROJ-100',
      amount: 500,
    };

    const callHandler: CallHandler = {
      handle: () => of(originalData),
    };

    const result$ = interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    expect(result.is_paused).toBe(false);
    expect(result.batchId).toBe('BATCH-001');
    expect(result.projectId).toBe('PROJ-100');
    expect(result.amount).toBe(500);
    expect(result.metadata.is_paused).toBe(false);
    expect(result.paused_at).toBeUndefined();
    expect(result.pause_reason).toBeUndefined();
    expect(responseHeaders['X-Contract-Is-Paused']).toBe('false');
  });

  it('includes is_paused=true, paused_at timestamp, and pause_reason when paused', async () => {
    const pausedAtDate = new Date('2026-10-19T12:00:00.000Z');
    const reason = 'Emergency security review';
    const prisma = createMockPrisma(true, reason, pausedAtDate);
    const interceptor = new ContractPauseResponseInterceptor(prisma);
    const { context, responseHeaders } = createMockExecutionContext();

    const originalData = {
      listingId: 'LIST-42',
      price: '15.50',
      active: true,
    };

    const callHandler: CallHandler = {
      handle: () => of(originalData),
    };

    const result$ = interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    expect(result.is_paused).toBe(true);
    expect(result.paused_at).toBe(pausedAtDate.toISOString());
    expect(result.pause_reason).toBe(reason);

    // Existing fields untouched
    expect(result.listingId).toBe('LIST-42');
    expect(result.price).toBe('15.50');
    expect(result.active).toBe(true);

    // Metadata object attached
    expect(result.metadata).toEqual({
      is_paused: true,
      paused_at: pausedAtDate.toISOString(),
      pause_reason: reason,
    });

    // HTTP headers
    expect(responseHeaders['X-Contract-Is-Paused']).toBe('true');
    expect(responseHeaders['X-Contract-Paused-At']).toBe(pausedAtDate.toISOString());
    expect(responseHeaders['X-Contract-Pause-Reason']).toBe(reason);
  });

  it('attaches pause fields to array responses in memory', async () => {
    const pausedAtDate = new Date('2026-10-19T12:00:00.000Z');
    const prisma = createMockPrisma(true, 'Maintenance', pausedAtDate);
    const interceptor = new ContractPauseResponseInterceptor(prisma);
    const { context } = createMockExecutionContext();

    const list = [{ id: 1 }, { id: 2 }];
    const callHandler: CallHandler = {
      handle: () => of(list),
    };

    const result$ = interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect((result as any).is_paused).toBe(true);
    expect((result as any).paused_at).toBe(pausedAtDate.toISOString());
    expect((result as any).pause_reason).toBe('Maintenance');
  });

  it('updates existing metadata field without overwriting other metadata properties', async () => {
    const prisma = createMockPrisma(true, 'Maintenance');
    const interceptor = new ContractPauseResponseInterceptor(prisma);
    const { context } = createMockExecutionContext();

    const originalData = {
      id: 'REC-1',
      metadata: {
        page: 1,
        total: 100,
      },
    };

    const callHandler: CallHandler = {
      handle: () => of(originalData),
    };

    const result$ = interceptor.intercept(context, callHandler);
    const result = await lastValueFrom(result$);

    expect(result.metadata.page).toBe(1);
    expect(result.metadata.total).toBe(100);
    expect(result.metadata.is_paused).toBe(true);
    expect(result.metadata.pause_reason).toBe('Maintenance');
  });
});
