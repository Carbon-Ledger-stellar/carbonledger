-- Migration: add_fulltext_search
--
-- Adds a generated tsvector column to CarbonProject for fast full-text search
-- over name, description, methodology, and country (#670).
--
-- Also adds a tsvector column on RetirementRecord covering beneficiary and
-- retirementReason so both surfaces can be queried from a single endpoint.
--
-- GIN indexes make @@  queries O(log n) even on large tables.

-- ── CarbonProject ─────────────────────────────────────────────────────────────

ALTER TABLE "CarbonProject"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("name",        '')), 'A') ||
      setweight(to_tsvector('english', coalesce("methodology", '')), 'B') ||
      setweight(to_tsvector('english', coalesce("country",     '')), 'B') ||
      setweight(to_tsvector('english', coalesce("description", '')), 'C')
    ) STORED;

CREATE INDEX IF NOT EXISTS "CarbonProject_searchVector_idx"
    ON "CarbonProject" USING GIN ("searchVector");

-- ── RetirementRecord ──────────────────────────────────────────────────────────

ALTER TABLE "RetirementRecord"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce("beneficiary",      '')), 'A') ||
      setweight(to_tsvector('english', coalesce("retirementReason", '')), 'B')
    ) STORED;

CREATE INDEX IF NOT EXISTS "RetirementRecord_searchVector_idx"
    ON "RetirementRecord" USING GIN ("searchVector");
