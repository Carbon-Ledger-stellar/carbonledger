/**
 * Tests for LoggerService — structured JSON logging + correlation ID threading.
 *
 * Covers:
 *  - Log structure (timestamp, level, message, correlationId, service)
 *  - Correlation ID auto-injection from AsyncLocalStorage
 *  - Sampling strategy (100% errors/warns, ~10% info/debug)
 *  - Sensitive field redaction
 *  - Actor and role propagation from request context
 */

import { Test, TestingModule } from '@nestjs/testing';
import * as winston from 'winston';
import Transport from 'winston-transport';
import { LoggerService } from './logger.service';
import { CorrelationIdContext } from './correlation-id.context';

// ── Custom in-process capture transport ──────────────────────────────────

class CaptureTranport extends Transport {
  readonly captured: Record<string, unknown>[] = [];

  log(info: Record<string, unknown>, callback: () => void): void {
    // Winston's JSON format has already serialised the entry into info[Symbol.for('message')]
    // but the raw fields are still directly on `info` before serialisation.
    this.captured.push({ ...info });
    callback();
  }
}

async function buildService(): Promise<{
  service: LoggerService;
  captured: Record<string, unknown>[];
}> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [LoggerService],
  }).compile();

  const service = module.get<LoggerService>(LoggerService);

  const capture = new CaptureTranport();
  service._winston.add(capture);

  return { service, captured: capture.captured };
}

// ── Log structure ─────────────────────────────────────────────────────────

describe('LoggerService — log structure', () => {
  it('emits a log entry with required fields for log()', async () => {
    const { service, captured } = await buildService();

    service.log('hello world');

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const entry = captured[captured.length - 1];
    expect(typeof entry.timestamp).toBe('string');
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello world');
    expect(entry.service).toBe('carbonledger-backend');
  });

  it('emits level=error for error()', async () => {
    const { service, captured } = await buildService();

    service.error('something broke', undefined, {});

    expect(captured.length).toBeGreaterThanOrEqual(1);
    const entry = captured[captured.length - 1];
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('something broke');
  });

  it('emits level=warn for warn()', async () => {
    const { service, captured } = await buildService();

    service.warn('careful now');

    const entry = captured[captured.length - 1];
    expect(entry.level).toBe('warn');
  });

  it('attaches extra context fields to the log entry', async () => {
    const { service, captured } = await buildService();

    service.log('with context', { actor: 'GABC', role: 'admin', endpoint: 'POST /credits' });

    const entry = captured[captured.length - 1];
    expect(entry.actor).toBe('GABC');
    expect(entry.role).toBe('admin');
    expect(entry.endpoint).toBe('POST /credits');
  });

  it('includes trace in error log', async () => {
    const { service, captured } = await buildService();

    service.error('err msg', 'Error: stack trace here\n  at line 1', {});

    const entry = captured[captured.length - 1];
    expect(entry.trace).toBe('Error: stack trace here\n  at line 1');
  });
});

// ── Correlation ID auto-injection ─────────────────────────────────────────

describe('LoggerService — correlation ID auto-injection', () => {
  it('injects correlationId from AsyncLocalStorage when not explicitly provided', async () => {
    const { service, captured } = await buildService();

    await new Promise<void>((resolve) => {
      CorrelationIdContext.run({ correlationId: 'test-corr-123' }, () => {
        service.log('inside request');
        resolve();
      });
    });

    const entry = captured[captured.length - 1];
    expect(entry.correlationId).toBe('test-corr-123');
  });

  it('injects actor and role from AsyncLocalStorage context', async () => {
    const { service, captured } = await buildService();

    await new Promise<void>((resolve) => {
      CorrelationIdContext.run(
        { correlationId: 'abc', actor: 'GSTELLAR', role: 'verifier' },
        () => {
          service.log('actor test');
          resolve();
        },
      );
    });

    const entry = captured[captured.length - 1];
    expect(entry.actor).toBe('GSTELLAR');
    expect(entry.role).toBe('verifier');
  });

  it('caller-supplied correlationId wins over AsyncLocalStorage', async () => {
    const { service, captured } = await buildService();

    await new Promise<void>((resolve) => {
      CorrelationIdContext.run({ correlationId: 'from-storage' }, () => {
        service.log('override', { correlationId: 'explicit-id' });
        resolve();
      });
    });

    const entry = captured[captured.length - 1];
    expect(entry.correlationId).toBe('explicit-id');
  });

  it('correlationId is absent or empty when no context is set', async () => {
    const { service, captured } = await buildService();

    service.log('no context');

    const entry = captured[captured.length - 1];
    expect(entry.correlationId == null || entry.correlationId === '').toBe(true);
  });

  it('getCorrelationId() returns the current context ID', async () => {
    const { service } = await buildService();

    const id = await new Promise<string>((resolve) => {
      CorrelationIdContext.run({ correlationId: 'get-me' }, () => {
        resolve(service.getCorrelationId());
      });
    });

    expect(id).toBe('get-me');
  });
});

// ── Context enrichment ────────────────────────────────────────────────────

describe('LoggerService — context enrichment', () => {
  it('setRequestActor enriches the current ALS context', async () => {
    const { service, captured } = await buildService();

    await new Promise<void>((resolve) => {
      CorrelationIdContext.run({ correlationId: 'enrich-test' }, () => {
        service.setRequestActor('GPUBKEY', 'project_developer');
        service.log('after enrichment');
        resolve();
      });
    });

    const entry = captured[captured.length - 1];
    expect(entry.actor).toBe('GPUBKEY');
    expect(entry.role).toBe('project_developer');
  });
});

// ── Sampling strategy ─────────────────────────────────────────────────────

describe('LoggerService — sampling strategy', () => {
  it('errors are always emitted (100% capture)', async () => {
    const { service, captured } = await buildService();

    for (let i = 0; i < 10; i++) {
      service.error(`error ${i}`, undefined, {});
    }

    const errors = captured.filter((e) => e.level === 'error');
    expect(errors).toHaveLength(10);
  });

  it('warns are always emitted', async () => {
    const { service, captured } = await buildService();

    for (let i = 0; i < 5; i++) {
      service.warn(`warn ${i}`);
    }

    const warns = captured.filter((e) => e.level === 'warn');
    expect(warns).toHaveLength(5);
  });

  it('all info logs are emitted in test environment (sampling bypassed)', async () => {
    // NODE_ENV=test → shouldSample() always returns true
    const { service, captured } = await buildService();

    for (let i = 0; i < 20; i++) {
      service.log(`info ${i}`);
    }

    const infos = captured.filter((e) => e.level === 'info');
    expect(infos).toHaveLength(20);
  });
});

// ── Sensitive field redaction ─────────────────────────────────────────────

describe('LoggerService — sensitive field redaction', () => {
  const sensitiveKeys = [
    'password', 'secret', 'token', 'key', 'api_key',
    'private_key', 'authorization', 'access_token', 'refresh_token',
  ];

  it.each(sensitiveKeys)('redacts "%s" field', async (sensitiveKey) => {
    const { service, captured } = await buildService();

    service.log('test', { [sensitiveKey]: 'super-secret-value' });

    const entry = captured[captured.length - 1];
    expect(entry[sensitiveKey]).toBe('[REDACTED]');
  });

  it('does NOT redact non-sensitive fields', async () => {
    const { service, captured } = await buildService();

    service.log('test', { publicField: 'visible', correlationId: 'abc' });

    const entry = captured[captured.length - 1];
    expect(entry.publicField).toBe('visible');
    expect(entry.correlationId).toBe('abc');
  });
});
