-- Migration: add_idempotency_record
-- Adds the IdempotencyRecord table used by the IdempotencyMiddleware to
-- deduplicate retries on POST /credits/mint, POST /marketplace/purchase,
-- and POST /retirements.
--
-- Records are keyed by (idempotencyKey, endpoint) and retained for 24 hours.
-- Cleanup is done opportunistically by the middleware on each request.

CREATE TABLE "IdempotencyRecord" (
    "id"             TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "endpoint"       TEXT NOT NULL,
    "requestHash"    TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "responseBody"   TEXT NOT NULL,
    "txHash"         TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- Composite unique constraint: one record per (key, endpoint) pair
CREATE UNIQUE INDEX "IdempotencyRecord_idempotencyKey_endpoint_key"
    ON "IdempotencyRecord"("idempotencyKey", "endpoint");

-- Index to support efficient TTL-based cleanup queries
CREATE INDEX "IdempotencyRecord_createdAt_idx"
    ON "IdempotencyRecord"("createdAt");
