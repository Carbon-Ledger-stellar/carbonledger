-- Migration: add_dead_letter_queue
-- Adds the DeadLetterJob table to persist BullMQ jobs that exhaust all retries.
-- This supports the BullMQ retry + DLQ feature (Issue #1145).

CREATE TABLE "DeadLetterJob" (
    "id"          TEXT NOT NULL,
    "jobId"       TEXT NOT NULL,
    "queueName"   TEXT NOT NULL,
    "jobType"     TEXT NOT NULL,
    "payload"     JSONB NOT NULL,
    "attempts"    INTEGER NOT NULL,
    "lastError"   TEXT NOT NULL,
    "errorStack"  TEXT,
    "enqueuedAt"  TIMESTAMP(3) NOT NULL,
    "failedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requeued"    BOOLEAN NOT NULL DEFAULT false,
    "requeuedAt"  TIMESTAMP(3),

    CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

-- Unique constraint on original BullMQ job ID to prevent duplicates
CREATE UNIQUE INDEX "DeadLetterJob_jobId_key" ON "DeadLetterJob"("jobId");

-- Index for filtering by queue + job type (most common query pattern)
CREATE INDEX "DeadLetterJob_queueName_jobType_idx" ON "DeadLetterJob"("queueName", "jobType");

-- Index for time-ordered listing of failures
CREATE INDEX "DeadLetterJob_failedAt_idx" ON "DeadLetterJob"("failedAt");

-- Index for filtering pending (non-requeued) entries
CREATE INDEX "DeadLetterJob_requeued_idx" ON "DeadLetterJob"("requeued");
