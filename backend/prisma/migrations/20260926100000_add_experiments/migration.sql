-- Migration: 20260926100000_add_experiments
-- Issue #1326: A/B experiment tracking for pause feature variations
--
-- Pure CREATE TABLE / CREATE INDEX — no existing table is touched.
-- Experiment state (status, rollout %, winner) is stored in the existing
-- AdminConfig table under keys "experiment:<key>".

CREATE TABLE "experiment_exposures" (
    "id"            TEXT         NOT NULL,
    "experimentKey" TEXT         NOT NULL,
    "variant"       TEXT         NOT NULL,
    "subjectHash"   TEXT         NOT NULL,
    "firstSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_exposures_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "experiment_exposures_experimentKey_subjectHash_key"
    ON "experiment_exposures"("experimentKey", "subjectHash");
CREATE INDEX "experiment_exposures_experimentKey_variant_idx"
    ON "experiment_exposures"("experimentKey", "variant");

CREATE TABLE "experiment_metric_events" (
    "id"            TEXT             NOT NULL,
    "experimentKey" TEXT             NOT NULL,
    "variant"       TEXT             NOT NULL,
    "subjectHash"   TEXT             NOT NULL,
    "metric"        TEXT             NOT NULL,
    "value"         DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt"     TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "experiment_metric_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "experiment_metric_events_experimentKey_metric_variant_idx"
    ON "experiment_metric_events"("experimentKey", "metric", "variant");
CREATE INDEX "experiment_metric_events_experimentKey_subjectHash_idx"
    ON "experiment_metric_events"("experimentKey", "subjectHash");

-- ── Down ──────────────────────────────────────────────────────────────────
-- DROP TABLE "experiment_metric_events";
-- DROP TABLE "experiment_exposures";
