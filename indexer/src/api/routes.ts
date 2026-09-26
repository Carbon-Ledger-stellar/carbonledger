/**
 * Express router for the CarbonLedger indexer API.
 *
 * SSE endpoint features:
 *  - Heartbeat every SSE_HEARTBEAT_MS ms (default 15 000) to keep connections alive
 *    through proxies and load balancers.
 *  - Reconnection replay: sends all buffered events with id > Last-Event-ID on reconnect.
 *  - Buffer-overflow detection: if Last-Event-ID is older than the buffer, a
 *    `buffer-overflow` event is sent so the client knows to do a full refresh.
 *  - X-SSE-Buffer-Size response header indicating current buffer usage on connection.
 *  - SSE_MAX_CLIENTS limit (default 500): returns HTTP 503 when exceeded.
 *  - Graceful shutdown: sends a `server-shutdown` event to all clients then closes.
 */

import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';

// ── Configuration ────────────────────────────────────────────────────────────

export const SSE_BUFFER_SIZE = parseInt(process.env.SSE_BUFFER_SIZE ?? '200', 10);
export const SSE_HEARTBEAT_MS = parseInt(process.env.SSE_HEARTBEAT_MS ?? '15000', 10);
export const SSE_MAX_CLIENTS = parseInt(process.env.SSE_MAX_CLIENTS ?? '500', 10);

// ── SSE event buffer ─────────────────────────────────────────────────────────

export interface SseEvent {
  id: number;
  type: string;
  data: unknown;
}

/**
 * Circular buffer for SSE events. Oldest events are evicted when the buffer
 * reaches SSE_BUFFER_SIZE.
 */
export class SseBuffer {
  private buffer: SseEvent[] = [];
  private readonly maxSize: number;

  constructor(maxSize = SSE_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  push(event: SseEvent): void {
    if (this.buffer.length >= this.maxSize) {
      this.buffer.shift(); // evict oldest
    }
    this.buffer.push(event);
  }

  /**
   * Returns all events with id strictly greater than `lastId`.
   * Returns null if the client's lastId is positive and older than the oldest
   * buffered event — indicating a gap the buffer cannot fill.
   * lastId === 0 means "give me all buffered events" (initial sync).
   */
  since(lastId: number): SseEvent[] | null {
    if (this.buffer.length === 0) return [];
    // lastId <= 0 means the client wants all events (first connect)
    if (lastId <= 0) {
      return this.buffer.filter((e) => e.id > lastId);
    }
    const oldest = this.buffer[0].id;
    if (lastId < oldest - 1) {
      // Gap: the client missed events we no longer have
      return null;
    }
    return this.buffer.filter((e) => e.id > lastId);
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }
}

// Shared instances
export const sseBuffer = new SseBuffer(SSE_BUFFER_SIZE);
export const sseEmitter = new EventEmitter();
sseEmitter.setMaxListeners(SSE_MAX_CLIENTS + 10);

// ── Connected-client tracking ────────────────────────────────────────────────

interface SseClient {
  res: Response;
  heartbeatTimer: ReturnType<typeof setInterval>;
}

const connectedClients = new Set<SseClient>();

// ── SSE frame helpers ────────────────────────────────────────────────────────

function writeSseComment(res: Response, comment: string): void {
  res.write(`: ${comment}\n\n`);
}

function writeSseEvent(res: Response, event: SseEvent): void {
  res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

function writeSseRawEvent(res: Response, type: string, data: unknown): void {
  res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ── Route factory ────────────────────────────────────────────────────────────

/**
 * Creates and returns the Express router.
 * Accepts an optional `emitter` override so tests can inject a custom emitter.
 */
export function createRouter(emitter: EventEmitter = sseEmitter): Router {
  const router = Router();

  // ── GET /events ────────────────────────────────────────────────────────────
  router.get('/events', (req: Request, res: Response) => {
    // Enforce max-clients limit
    if (connectedClients.size >= SSE_MAX_CLIENTS) {
      res
        .status(503)
        .json({ error: 'Service Unavailable', message: 'Maximum SSE client limit reached. Try again later.' });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    res.setHeader('X-SSE-Buffer-Size', String(sseBuffer.size()));
    res.flushHeaders();

    // Handle Last-Event-ID reconnection replay
    const lastEventIdHeader = req.headers['last-event-id'];
    if (lastEventIdHeader) {
      const lastId = parseInt(String(lastEventIdHeader), 10);
      if (!isNaN(lastId)) {
        const missed = sseBuffer.since(lastId);
        if (missed === null) {
          // Buffer overflow — client must do a full refresh
          writeSseRawEvent(res, 'buffer-overflow', {
            message: 'Requested event is older than the buffer. Perform a full data refresh.',
            lastId,
          });
        } else {
          // Replay missed events
          for (const event of missed) {
            writeSseEvent(res, event);
          }
        }
      }
    }

    // Send initial comment so the client knows the stream is alive
    writeSseComment(res, 'connected');

    // Heartbeat to prevent proxy/LB timeouts
    const heartbeatTimer = setInterval(() => {
      try {
        writeSseComment(res, 'heartbeat');
      } catch {
        // Client disconnected between ticks — cleanup will handle it
      }
    }, SSE_HEARTBEAT_MS);

    const client: SseClient = { res, heartbeatTimer };
    connectedClients.add(client);

    // Forward events from emitter to this client
    const onEvent = (event: SseEvent) => {
      try {
        writeSseEvent(res, event);
      } catch {
        // Ignore write errors; cleanup on close
      }
    };
    emitter.on('event', onEvent);

    // Cleanup on client disconnect
    req.on('close', () => {
      clearInterval(heartbeatTimer);
      emitter.off('event', onEvent);
      connectedClients.delete(client);
    });
  });

  // ── GET /metrics ───────────────────────────────────────────────────────────
  router.get('/metrics', async (_req, res) => {
    try {
      const { metricsRegistry } = await import('./rate-limit-middleware');
      const metrics = await metricsRegistry.metrics();
      res.set('Content-Type', metricsRegistry.contentType);
      res.send(metrics);
    } catch (err) {
      res.status(500).json({ error: 'Failed to collect metrics' });
    }
  });

  return router;
}

// ── Event publisher ──────────────────────────────────────────────────────────

let nextEventId = 1;

/**
 * Publish a new event to all connected SSE clients and add it to the buffer.
 */
export function publishEvent(type: string, data: unknown): void {
  const event: SseEvent = { id: nextEventId++, type, data };
  sseBuffer.push(event);
  sseEmitter.emit('event', event);
}

// ── Graceful shutdown ────────────────────────────────────────────────────────

/**
 * Send a `server-shutdown` event to all connected clients, then close their
 * responses. Call this during SIGTERM/SIGINT handling.
 */
export function shutdownSseClients(): void {
  for (const client of connectedClients) {
    try {
      writeSseRawEvent(client.res, 'server-shutdown', {
        message: 'Server is shutting down. Please reconnect.',
      });
      clearInterval(client.heartbeatTimer);
      client.res.end();
    } catch {
      // Already closed
    }
  }
  connectedClients.clear();
}

export { connectedClients };
