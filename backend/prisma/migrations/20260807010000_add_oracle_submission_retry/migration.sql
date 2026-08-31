-- Migration: add_oracle_submission_retry (issue #578)
--
-- Two tables backing idempotent retry in the verification listener.
--
-- oracle_submission_nonces — one row per logical submission.
--   submission_id is content-addressed: sha256(canonical_json(payload)).  The
--   primary key is what makes duplicate rejection atomic — a replay after a
--   crash conflicts on INSERT and never reaches the blockchain.
--   nonce is allocated once at claim time and reused across every retry, so a
--   retry of a submission that actually landed (but whose response was lost) is
--   rejected on chain with InvalidNonce instead of recording the data twice.
--
-- oracle_dead_letters — permanently failed submissions with full context:
--   the payload, every error seen, attempt count and timestamps.  Unlike the
--   Redis DLQ used by the price oracle, these survive a Redis flush, which is
--   what an operator needs to decide whether a batch is safe to replay.
--
-- Additive, new tables — zero-downtime safe.  snake_case to match the other
-- oracle-owned tables the Python bridge writes to (oracle_submissions, …).

CREATE TABLE IF NOT EXISTS "oracle_submission_nonces" (
    "submission_id" CHAR(64)     NOT NULL,
    "service"       VARCHAR(50)  NOT NULL,
    "function_name" VARCHAR(100) NOT NULL,
    "payload_hash"  CHAR(64)     NOT NULL,
    "nonce"         BIGINT       NOT NULL,
    "status"        VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "tx_hash"       VARCHAR(200),
    "created_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "updated_at"    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "oracle_submission_nonces_pkey" PRIMARY KEY ("submission_id")
);

-- One nonce per submission, never reused by another: this is the on-chain half
-- of the exactly-once guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS "oracle_submission_nonces_nonce_key"
    ON "oracle_submission_nonces"("nonce");

CREATE INDEX IF NOT EXISTS "oracle_submission_nonces_status_idx"
    ON "oracle_submission_nonces"("status");

CREATE TABLE IF NOT EXISTS "oracle_dead_letters" (
    "submission_id"   CHAR(64)     NOT NULL,
    "service"         VARCHAR(50)  NOT NULL,
    "function_name"   VARCHAR(100) NOT NULL,
    "payload"         JSONB        NOT NULL,
    "nonce"           BIGINT,
    "attempts"        INTEGER      NOT NULL DEFAULT 0,
    "last_error"      TEXT,
    "error_history"   JSONB        NOT NULL DEFAULT '[]'::jsonb,
    "resolved"        BOOLEAN      NOT NULL DEFAULT false,
    "resolution_note" TEXT,
    "resolved_at"     TIMESTAMPTZ,
    "first_failed_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    "last_failed_at"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "oracle_dead_letters_pkey" PRIMARY KEY ("submission_id")
);

-- Depth alerting counts unresolved entries; this index keeps that check cheap.
CREATE INDEX IF NOT EXISTS "oracle_dead_letters_resolved_idx"
    ON "oracle_dead_letters"("resolved");

CREATE INDEX IF NOT EXISTS "oracle_dead_letters_last_failed_at_idx"
    ON "oracle_dead_letters"("last_failed_at" DESC);

COMMENT ON TABLE "oracle_submission_nonces"
  IS 'Idempotency ledger for oracle submissions (#578). One row per content-addressed submission id; nonce is reused across retries to make replays fail on chain.';

COMMENT ON TABLE "oracle_dead_letters"
  IS 'Permanently failed oracle submissions with full failure context (#578). Alerting fires when the unresolved count exceeds DLQ_ALERT_THRESHOLD.';
