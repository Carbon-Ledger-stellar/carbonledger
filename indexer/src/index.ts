/**
 * CarbonLedger Indexer API — Express entrypoint.
 *
 * Mounts:
 *  - Blocklist check (all routes)
 *  - Tiered rate limiting (all routes)
 *  - Admin routes (protected by ADMIN_TOKEN)
 *  - SSE and metrics routes
 *
 * Graceful shutdown:
 *  1. Sends `server-shutdown` SSE event to all connected clients.
 *  2. Closes the HTTP server.
 *  3. Closes the Redis connection.
 */

import express from 'express';
import { blocklistMiddleware, tieredRateLimitMiddleware, adminAuthMiddleware, listApiKeys, addApiKey, deleteApiKey, unblockIp } from './api/rate-limit-middleware';
import { createRouter, shutdownSseClients } from './api/routes';
import { closeRedisClient } from './redis-client';
import * as http from 'http';

const PORT = parseInt(process.env.PORT ?? '4000', 10);

export function createApp(): express.Application {
  const app = express();

  app.use(express.json());

  // ── Global middleware ──────────────────────────────────────────────────────

  // 1. Check blocklist before any rate limiting
  app.use(blocklistMiddleware);

  // 2. Tiered rate limiting
  app.use(tieredRateLimitMiddleware);

  // ── Admin routes ───────────────────────────────────────────────────────────

  const admin = express.Router();
  admin.use(adminAuthMiddleware);

  admin.get('/api-keys', listApiKeys);
  admin.post('/api-keys', addApiKey);
  admin.delete('/api-keys/:key', deleteApiKey);
  admin.post('/unblock-ip', unblockIp);

  app.use('/admin', admin);

  // ── API routes ─────────────────────────────────────────────────────────────

  app.use('/', createRouter());

  // ── Health check ───────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  return app;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

if (require.main === module) {
  const app = createApp();
  const server: http.Server = app.listen(PORT, () => {
    console.log(`[indexer] Listening on port ${PORT}`);
  });

  let isShuttingDown = false;

  async function gracefulShutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`[indexer] Received ${signal}, shutting down gracefully...`);

    // 1. Notify all SSE clients
    shutdownSseClients();

    // 2. Stop accepting new connections
    server.close(async () => {
      console.log('[indexer] HTTP server closed');

      // 3. Close Redis
      await closeRedisClient();
      console.log('[indexer] Redis connection closed');

      process.exit(0);
    });

    // Force shutdown after 10 seconds if graceful shutdown stalls
    setTimeout(() => {
      console.error('[indexer] Forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
