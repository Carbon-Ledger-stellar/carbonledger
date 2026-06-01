"use client";

import { useState } from "react";
import { useListings } from "../../lib/api";
import { colors } from "../../styles/design-system";
import CreditCard from "../../components/CreditCard";
import MarketplaceFilter, { FilterState } from "../../components/MarketplaceFilter";
import LoadingSkeleton from "../../components/LoadingSkeleton";

export default function MarketplacePage() {
  const [filters, setFilters] = useState<FilterState>({
    methodology: "", vintageYear: "", country: "", minPrice: "", maxPrice: "",
  });

  const { listings, total_count, hasMore, isLoading, isValidating, error, setSize, size } = useListings({
    methodology: filters.methodology || undefined,
    vintage:     filters.vintageYear ? Number(filters.vintageYear) : undefined,
    country:     filters.country     || undefined,
    minPrice:    filters.minPrice    || undefined,
    maxPrice:    filters.maxPrice    || undefined,
  });

  const isLoadingMore = isValidating && listings.length > 0;
  const isFirstLoad   = isLoading && listings.length === 0;

  return (
    <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
          Carbon Credit Marketplace
        </h1>
        <p style={{ color: colors.neutral[500], margin: 0 }}>
          All credits are from verified projects with full satellite monitoring. Prices in USDC.
        </p>
      </div>

      <div style={{ marginBottom: "1.5rem" }}>
        <MarketplaceFilter filters={filters} onChange={setFilters} />
      </div>

      {error ? (
        <div style={{
          textAlign: "center", padding: "4rem",
          background: "#fef2f2", border: "1px solid #fecaca",
          borderRadius: "0.75rem", color: "#dc2626",
        }}>
          <p style={{ fontWeight: 600, margin: "0 0 0.5rem" }}>Failed to load listings</p>
          <p style={{ fontSize: "0.875rem", margin: 0, color: "#ef4444" }}>{error.message}</p>
        </div>
      ) : isFirstLoad ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.5rem" }}>
          {Array.from({ length: 9 }).map((_, i) => <LoadingSkeleton key={i} variant="CreditCard" />)}
        </div>
      ) : (
        <>
          <p style={{ fontSize: "0.875rem", color: colors.neutral[500], marginBottom: "1rem" }}>
            {listings.length} of {total_count} listings
          </p>

          {listings.length === 0 ? (
            <div style={{ textAlign: "center", padding: "4rem", color: colors.neutral[400] }}>
              No listings match your filters.
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.5rem" }}>
              {listings.map(l => (
                <CreditCard
                  key={l.listingId}
                  listing={l}
                  onBuy={() => window.location.href = `/buy?listing=${l.listingId}`}
                />
              ))}
            </div>
          )}

          {hasMore && (
            <div style={{ textAlign: "center", marginTop: "2rem" }}>
              <button
                onClick={() => setSize(size + 1)}
                disabled={isLoadingMore}
                style={{
                  background: isLoadingMore ? colors.neutral[200] : colors.primary[600],
                  color: isLoadingMore ? colors.neutral[500] : "#fff",
                  border: "none",
                  borderRadius: "0.5rem",
                  padding: "0.75rem 2rem",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: isLoadingMore ? "not-allowed" : "pointer",
                }}
              >
                {isLoadingMore ? "Loading…" : "Load More"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
