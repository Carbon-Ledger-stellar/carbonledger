/**
 * Tests for SSE routes: heartbeat, reconnection replay, buffer overflow,
 * max-clients limit, and server shutdown cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import type { Request, Response } from 'express';

import {
  SseBuffer,
  createRouter,
  shutdownSseClients,
  publishEvent,
  sseBuffer,
  sseEmitter,
  connectedClients,
  SSE_HEARTBEAT_MS,
  SSE_MAX_CLIENTS,
  SSE_BUFFER_SIZE,
} from './routes';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request & { on: ReturnType<typeof vi.fn> } {
  const listeners: Record<string, () => void> = {};
  const on = vi.fn((event: string, cb: () => void) => {
    listeners[event] = cb;
  });
  return {
    headers: {},
    params: {},
    socket: { remoteAddress: '10.0.0.1' },
    on,
    _listeners: listeners,
    ...overrides,
  } as unknown as Request & { on: ReturnType<typeof vi.fn> };
}

interface MockRes {
  res: Response;
  write: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  flushHeaders: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function makeRes(): MockRes {
  const write = vi.fn();
  const setHeader = vi.fn();
  const flushHeaders = vi.fn();
  const json = vi.fn();
  const end = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const res = { write, setHeader, flushHeaders, status, json, end } as unknown as Response;
  return { res, write, setHeader, flushHeaders, status, json, end };
}

// ── SseBuffer ─────────────────────────────────────────────────────────────────

describe('SseBuffer', () => {
  it('stores events up to maxSize', () => {
    const buf = new SseBuffer(3);
    buf.push({ id: 1, type: 'a', data: {} });
    buf.push({ id: 2, type: 'b', data: {} });
    buf.push({ id: 3, type: 'c', data: {} });
    expect(buf.size()).toBe(3);
  });

  it('evicts the oldest event when full', () => {
    const buf = new SseBuffer(3);
    buf.push({ id: 1, type: 'a', data: {} });
    buf.push({ id: 2, type: 'b', data: {} });
    buf.push({ id: 3, type: 'c', data: {} });
    buf.push({ id: 4, type: 'd', data: {} });
    expect(buf.size()).toBe(3);
    // id=1 should have been evicted; buffer now holds 2,3,4
    // since(0) = "give me all" — should return the 3 remaining events (not null)
    const allEvents = buf.since(0);
    expect(allEvents).not.toBeNull();
    expect(allEvents?.find(e => e.id === 1)).toBeUndefined();
    expect(allEvents?.map(e => e.id)).toEqual([2, 3, 4]);
  });

  it('since() returns events after lastId', () => {
    const buf = new SseBuffer(10);
    [1, 2, 3, 4, 5].forEach(id => buf.push({ id, type: 'x', data: id }));
    const result = buf.since(2);
    expect(result?.map(e => e.id)).toEqual([3, 4, 5]);
  });

  it('since() returns empty array for lastId >= latest', () => {
    const buf = new SseBuffer(10);
    buf.push({ id: 1, type: 'x', data: {} });
    buf.push({ id: 2, type: 'x', data: {} });
    expect(buf.since(5)).toEqual([]);
  });

  it('since() returns null for buffer overflow (gap in events)', () => {
    const buf = new SseBuffer(3);
    // Fill with ids 10, 11, 12 — oldest in buffer is 10
    [10, 11, 12].forEach(id => buf.push({ id, type: 'x', data: {} }));
    // Ask for events since id=5 — there's a gap (ids 6-9 are missing)
    expect(buf.since(5)).toBeNull();
  });

  it('since() returns all events when lastId is 0 and buffer is not overflowed', () => {
    const buf = new SseBuffer(10);
    [1, 2, 3].forEach(id => buf.push({ id, type: 'x', data: {} }));
    const result = buf.since(0);
    expect(result?.length).toBe(3);
  });
});

// ── SSE constants ─────────────────────────────────────────────────────────────

describe('SSE constants', () => {
  it('SSE_HEARTBEAT_MS defaults to 15000', () => {
    expect(SSE_HEARTBEAT_MS).toBe(15000);
  });

  it('SSE_MAX_CLIENTS defaults to 500', () => {
    expect(SSE_MAX_CLIENTS).toBe(500);
  });

  it('SSE_BUFFER_SIZE defaults to 200', () => {
    expect(SSE_BUFFER_SIZE).toBe(200);
  });
});

// ── GET /events — SSE connection setup ────────────────────────────────────────

describe('GET /events — connection setup', () => {
  beforeEach(() => {
    sseBuffer.clear();
    connectedClients.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    connectedClients.clear();
  });

  it('sets correct SSE headers', () => {
    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq();
    const { res, setHeader, flushHeaders } = makeRes();

    // Find the /events route handler
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());

    expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache, no-transform');
    expect(setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(flushHeaders).toHaveBeenCalledOnce();
  });

  it('includes X-SSE-Buffer-Size header', () => {
    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq();
    const { res, setHeader } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());
    expect(setHeader).toHaveBeenCalledWith('X-SSE-Buffer-Size', expect.any(String));
  });

  it('sends initial `: connected` comment', () => {
    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq();
    const { res, write } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());
    const writes = (write as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(writes.some((w: string) => w.includes(': connected'))).toBe(true);
  });

  it('sends heartbeat comment after SSE_HEARTBEAT_MS', () => {
    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq();
    const { res, write } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());

    vi.advanceTimersByTime(SSE_HEARTBEAT_MS + 100);
    const writes = (write as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
    expect(writes.some((w: string) => w.includes(': heartbeat'))).toBe(true);
  });

  it('registers client in connectedClients', () => {
    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq();
    const { res } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());
    expect(connectedClients.size).toBe(1);
  });

  it('removes client from connectedClients on close', () => {
    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq();
    const { res } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());
    expect(connectedClients.size).toBe(1);

    // Simulate client disconnect
    (req as any)._listeners['close']?.();
    expect(connectedClients.size).toBe(0);
  });
});

// ── GET /events — Last-Event-ID reconnection replay ──────────────────────────

describe('GET /events — Last-Event-ID replay', () => {
  beforeEach(() => {
    sseBuffer.clear();
    connectedClients.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    connectedClients.clear();
  });

  it('replays missed events when Last-Event-ID is in buffer', () => {
    // Populate buffer with events 1-5
    [1, 2, 3, 4, 5].forEach(id => sseBuffer.push({ id, type: 'test', data: { id } }));

    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq({ headers: { 'last-event-id': '2' } });
    const { res, write } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());

    const writeCalls = (write as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
    // Should have replayed events 3, 4, 5
    expect(writeCalls.some(w => w.includes('"id":3'))).toBe(true);
    expect(writeCalls.some(w => w.includes('"id":4'))).toBe(true);
    expect(writeCalls.some(w => w.includes('"id":5'))).toBe(true);
    // Should NOT have replayed events 1 or 2
    expect(writeCalls.filter(w => w.startsWith('id: 1\n')).length).toBe(0);
    expect(writeCalls.filter(w => w.startsWith('id: 2\n')).length).toBe(0);
  });

  it('sends buffer-overflow event when Last-Event-ID is too old', () => {
    // Buffer holds events 50-52 (size=3)
    const smallBuffer = new SseBuffer(3);
    smallBuffer.push({ id: 50, type: 'x', data: {} });
    smallBuffer.push({ id: 51, type: 'x', data: {} });
    smallBuffer.push({ id: 52, type: 'x', data: {} });

    // We simulate this by using the already-exported sseBuffer
    // but we manually call the route with a very old last-event-id
    // The global sseBuffer starts empty, so let's fill it
    sseBuffer.clear();
    for (let i = 10; i <= 10 + SSE_BUFFER_SIZE; i++) {
      sseBuffer.push({ id: i, type: 'x', data: {} });
    }
    // Now ask for events since id=1 — there's definitely a gap
    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq({ headers: { 'last-event-id': '1' } });
    const { res, write } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());

    const writeCalls = (write as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0] as string);
    expect(writeCalls.some(w => w.includes('buffer-overflow'))).toBe(true);
  });
});

// ── GET /events — max clients ─────────────────────────────────────────────────

describe('GET /events — max clients limit', () => {
  beforeEach(() => {
    sseBuffer.clear();
    connectedClients.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    connectedClients.clear();
  });

  it('returns 503 when connectedClients.size >= SSE_MAX_CLIENTS', () => {
    // Fill up to max — use unique objects so Set doesn't deduplicate
    for (let i = 0; i < SSE_MAX_CLIENTS; i++) {
      connectedClients.add({
        res: {} as Response,
        heartbeatTimer: i as unknown as ReturnType<typeof setInterval>,
      });
    }

    const emitter = new EventEmitter();
    const router = createRouter(emitter);
    const req = makeReq();
    const { res, status, json } = makeRes();
    const layer = (router as any).stack.find((l: any) => l.route?.path === '/events');
    layer.route.stack[0].handle(req, res, vi.fn());

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Service Unavailable' }),
    );
  });
});

// ── shutdownSseClients ─────────────────────────────────────────────────────────

describe('shutdownSseClients', () => {
  beforeEach(() => {
    connectedClients.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    connectedClients.clear();
  });

  it('sends server-shutdown event to all clients and clears the set', () => {
    const write1 = vi.fn();
    const write2 = vi.fn();
    const end1 = vi.fn();
    const end2 = vi.fn();
    const timer = vi.fn() as unknown as ReturnType<typeof setInterval>;

    connectedClients.add({
      res: { write: write1, end: end1 } as unknown as Response,
      heartbeatTimer: timer,
    });
    connectedClients.add({
      res: { write: write2, end: end2 } as unknown as Response,
      heartbeatTimer: timer,
    });

    shutdownSseClients();

    expect(write1).toHaveBeenCalledWith(expect.stringContaining('server-shutdown'));
    expect(write2).toHaveBeenCalledWith(expect.stringContaining('server-shutdown'));
    expect(end1).toHaveBeenCalledOnce();
    expect(end2).toHaveBeenCalledOnce();
    expect(connectedClients.size).toBe(0);
  });
});

// ── publishEvent ──────────────────────────────────────────────────────────────

describe('publishEvent', () => {
  beforeEach(() => {
    sseBuffer.clear();
    connectedClients.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    connectedClients.clear();
  });

  it('adds event to sseBuffer', () => {
    const before = sseBuffer.size();
    publishEvent('test', { foo: 'bar' });
    expect(sseBuffer.size()).toBe(before + 1);
  });

  it('emits event to connected clients via sseEmitter', () => {
    const received: unknown[] = [];
    sseEmitter.on('event', (e) => received.push(e));
    publishEvent('credit-minted', { batchId: 'abc' });
    sseEmitter.removeAllListeners('event');
    expect(received).toHaveLength(1);
    expect((received[0] as any).type).toBe('credit-minted');
  });
});
