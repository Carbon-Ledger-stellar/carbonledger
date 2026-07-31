-- Migration: marketplace_fulltext_search
--
-- Adds full-text search capability to MarketListing:
--
--   1. A `searchVector` tsvector column maintained by a BEFORE INSERT/UPDATE trigger
--      (cannot use GENERATED ALWAYS AS because MarketListing.projectId is a foreign
--       key and the project name lives on a different table — triggers let us JOIN
--       across tables during the update).
--
--   2. A GIN index on `searchVector` for O(log n) @@ queries.
--
--   3. A composite B-tree index on the 5 faceted-filter columns to support
--      multi-facet queries without sequential scans.
--
--   4. A separate index on `pricePerCredit` cast to numeric to support
--      range queries (minPrice / maxPrice) efficiently.
--
-- The trigger function populates searchVector from:
--   A weight — projectId (identifier, high relevance)
--   B weight — methodology (faceted field, high relevance)
--   B weight — country    (faceted field, high relevance)
--   C weight — seller     (public key, lower relevance)
--
-- Project name and description full-text is already indexed on CarbonProject
-- via the existing searchVector there (#670); the marketplace search endpoint
-- joins to CarbonProject and combines both vectors at query time.

-- ── 1. Add the tsvector column ────────────────────────────────────────────────

ALTER TABLE "MarketListing"
  ADD COLUMN IF NOT EXISTS "searchVector" tsvector;

-- ── 2. Create the trigger function ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION marketplace_listing_search_vector_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  project_name        text;
  project_description text;
BEGIN
  -- Fetch the related project name + description for richer search coverage.
  -- The SELECT is cheap because CarbonProject.projectId is a unique-indexed PK.
  SELECT name, description
    INTO project_name, project_description
    FROM "CarbonProject"
   WHERE "projectId" = NEW."projectId";

  NEW."searchVector" :=
      setweight(to_tsvector('english', coalesce(project_name,        '')), 'A') ||
      setweight(to_tsvector('english', coalesce(NEW."methodology",   '')), 'B') ||
      setweight(to_tsvector('english', coalesce(NEW."country",       '')), 'B') ||
      setweight(to_tsvector('english', coalesce(project_description, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(NEW."projectId",     '')), 'D');

  RETURN NEW;
END;
$$;

-- ── 3. Attach trigger to MarketListing ───────────────────────────────────────

DROP TRIGGER IF EXISTS marketplace_listing_search_vector_trigger ON "MarketListing";

CREATE TRIGGER marketplace_listing_search_vector_trigger
BEFORE INSERT OR UPDATE
ON "MarketListing"
FOR EACH ROW
EXECUTE FUNCTION marketplace_listing_search_vector_update();

-- ── 4. Back-fill existing rows ────────────────────────────────────────────────

UPDATE "MarketListing" SET "updatedAt" = "updatedAt"
WHERE "searchVector" IS NULL;

-- ── 5. GIN index on searchVector ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "MarketListing_searchVector_idx"
    ON "MarketListing" USING GIN ("searchVector");

-- ── 6. Composite B-tree index for faceted filters ─────────────────────────────
--
-- Covers the 5 core facets: methodology, vintageYear, country, status, seller.
-- PostgreSQL can use a partial prefix of this index for any subset of the
-- leading columns, so single-facet queries also benefit.

CREATE INDEX IF NOT EXISTS "MarketListing_facets_idx"
    ON "MarketListing" ("methodology", "vintageYear", "country", "status", "seller");

-- ── 7. Index for numeric price range queries ──────────────────────────────────
--
-- pricePerCredit is stored as TEXT (Stellar stroops string).  Cast to numeric
-- so range comparisons skip rows without a full-table cast at runtime.

CREATE INDEX IF NOT EXISTS "MarketListing_pricePerCredit_numeric_idx"
    ON "MarketListing" (CAST("pricePerCredit" AS NUMERIC));
