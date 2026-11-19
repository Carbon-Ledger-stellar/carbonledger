# Indexer

The indexer service consumes on-chain events emitted by the marketplace contracts, normalizes them, and exposes them to clients over HTTP and Server-Sent Events (SSE). It is the read-side companion to the contracts: rather than querying the chain on every request, clients subscribe to the indexer and receive a consistent, ordered stream of events.

## Purpose

- **Ingest** contract events (listings, sales, offers, cancellations, etc.) from the chain.
- **Normalize** them into a stable, versioned event schema (see below).
- **Serve** them to clients via a REST API and a live SSE stream.
- **Persist** recent state in Redis so multiple instances and restarts stay consistent.

## Architecture

```
src/index.ts          Express entrypoint: middleware, routes, SSE, graceful shutdown
src/redis-client.ts   Shared Redis client (connection, retries, pub/sub)
src/**/*.test.ts      Vitest unit/integration tests
```

### Entrypoint (`src/index.ts`)

The service boots an Express application. Middleware is registered in a deliberate order:

1. **Body parsing** — JSON body parser for API requests.
2. **Request logging** — structured logs for every inbound request.
3. **CORS** — allows browser clients to call the API.
4. **Authentication** — admin-only routes are guarded by the `ADMIN_TOKEN` bearer token.
5. **Routes** — REST endpoints for querying indexed events.
6. **SSE endpoint** — `/events` (or equivalent) keeps the connection open and pushes new events as they are indexed.
7. **Error handling** — centralized error middleware returns consistent JSON errors.

### SSE

The SSE endpoint holds long-lived HTTP connections. When the indexer ingests a new event it publishes it to subscribers over SSE. Clients should reconnect automatically; the server sends periodic keep-alive comments to prevent idle timeouts.

### Graceful shutdown

On `SIGINT`/`SIGTERM` the process stops accepting new connections, drains in-flight requests, closes SSE streams, and disconnects the Redis client before exiting. This avoids dropping events or leaving dangling subscriptions.

### Redis client (`src/redis-client.ts`)

A single shared Redis client is created at startup and reused across the app. It handles connection retries and is used both for persistence and for pub/sub fan-out of events to SSE subscribers. The connection string comes from `REDIS_URL`.

## Event schema

All indexed events share a common envelope and carry an event-specific `data` payload.

| Event | `type` | Key `data` fields | Description |
| --- | --- | --- | --- |
| Listing created | `listing.created` | `listingId`, `seller`, `tokenId`, `price`, `currency` | A new item was listed for sale. |
| Listing updated | `listing.updated` | `listingId`, `price`, `currency` | An existing listing's price or terms changed. |
| Listing cancelled | `listing.cancelled` | `listingId`, `seller` | A listing was withdrawn. |
| Sale completed | `sale.completed` | `listingId`, `buyer`, `seller`, `price`, `tokenId` | An item was purchased. |
| Offer made | `offer.created` | `offerId`, `listingId`, `buyer`, `amount`, `currency` | A buyer placed an offer. |
| Offer accepted | `offer.accepted` | `offerId`, `listingId`, `buyer`, `seller` | An offer was accepted. |
| Offer cancelled | `offer.cancelled` | `offerId`, `buyer` | An offer was withdrawn. |

### Common envelope

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Unique event identifier (chain tx hash + log index). |
| `type` | `string` | Event type from the table above. |
| `blockNumber` | `number` | Block in which the event was emitted. |
| `txHash` | `string` | Transaction hash. |
| `timestamp` | `number` | Unix timestamp (seconds) of the block. |
| `data` | `object` | Event-specific payload (see table). |

## Running locally

```bash
# Install dependencies
npm install

# Start in watch mode (development)
npm run dev

# Production build and start
npm run build
npm start
```

### Environment variables

| Variable | Required | Description |
| --- | --- | --- |
| `REDIS_URL` | Yes | Redis connection string, e.g. `redis://localhost:6379`. |
| `PORT` | No | HTTP port to listen on (default `3000`). |
| `ADMIN_TOKEN` | Yes | Bearer token required for admin routes. |

## Running tests

Tests use [Vitest](https://vitest.dev/) and live alongside the source as `src/**/*.test.ts` (configured in `vitest.config.ts`).

```bash
# Run the full test suite once
npm test

# Re-run tests on file changes
npm run test:watch

# Run with coverage report
npm run test:coverage