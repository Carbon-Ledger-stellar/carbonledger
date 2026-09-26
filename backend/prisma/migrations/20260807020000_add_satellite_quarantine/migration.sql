-- Migration: add_satellite_quarantine (issue #579)
--
-- Holding queue for satellite monitoring submissions that pass schema and
-- coordinate validation but whose sequestration claim is statistically
-- implausible for the project.
--
-- Quarantine is deliberately distinct from rejection: the full payload is
-- retained so a reviewer can approve a genuine step change (a project expanding
-- its area looks identical to fraud from a single sample), rather than the data
-- being discarded at the door.
--
-- UNIQUE (project_id, period) means a provider that keeps retrying updates the
-- existing entry instead of piling up duplicates for the reviewer.
--
-- Written by oracle/satellite_validation.py; reviewed through the backend admin
-- API at /admin/satellite/quarantine.  Additive, new table — zero-downtime safe.

CREATE TABLE IF NOT EXISTS "satellite_quarantine" (
    "id"             BIGSERIAL    NOT NULL,
    "project_id"     VARCHAR(200) NOT NULL,
    "period"         VARCHAR(100) NOT NULL,
    "provider_id"    VARCHAR(200),
    "payload"        JSONB        NOT NULL,
    "reason"         TEXT         NOT NULL,
    "stats"          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "status"         VARCHAR(20)  NOT NULL DEFAULT 'pending',
    "reviewed_by"    VARCHAR(200),
    "review_note"    TEXT,
    "reviewed_at"    TIMESTAMPTZ,
    "quarantined_at" TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    CONSTRAINT "satellite_quarantine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "satellite_quarantine_project_id_period_key"
    ON "satellite_quarantine"("project_id", "period");

-- The admin queue view filters on status and orders by recency.
CREATE INDEX IF NOT EXISTS "satellite_quarantine_status_idx"
    ON "satellite_quarantine"("status");

CREATE INDEX IF NOT EXISTS "satellite_quarantine_quarantined_at_idx"
    ON "satellite_quarantine"("quarantined_at" DESC);

CREATE INDEX IF NOT EXISTS "satellite_quarantine_project_id_idx"
    ON "satellite_quarantine"("project_id");

COMMENT ON TABLE "satellite_quarantine"
  IS 'Satellite submissions held for manual review after failing statistical anomaly detection (#579). status: pending | approved | rejected.';
