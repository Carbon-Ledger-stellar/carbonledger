-- Add performance optimization indexes
-- These indexes optimize common query patterns for project listings, market browsing, and batch lookups

-- Index for project status filtering with sorting by creation date
CREATE INDEX "idx_carbon_project_status_created_at" ON "CarbonProject"(status, "createdAt" DESC);

-- Index for country-based filtering with status
CREATE INDEX "idx_carbon_project_country_status" ON "CarbonProject"(country, status);

-- Index for batch lookups by project ID and status
CREATE INDEX "idx_credit_batch_project_status" ON "CreditBatch"("projectId", status);

-- Index for market listing browsing by status with pagination
CREATE INDEX "idx_market_listing_status_created_at" ON "MarketListing"(status, "createdAt" DESC);

-- Index for market listing search with multiple filters
-- This supports queries filtering by methodology, vintage year, and status
CREATE INDEX "idx_market_listing_methodology_vintage_status" ON "MarketListing"(methodology, "vintageYear", status);

-- Index for user retirement history lookup
CREATE INDEX "idx_retirement_retired_by_at" ON "RetirementRecord"("retiredBy", "retiredAt" DESC);
