"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useListings, MarketListing } from "../../lib/api";
import { useCartStore } from "../../lib/use-cart-store";
import { formatStroops, formatTonnes } from "../../lib/carbon-utils";
import { colors } from "../../styles/design-system";
import MarketplaceFilter, { FilterState, EMPTY_FILTERS } from "../../components/MarketplaceFilter";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import Toast, { useToast } from "../../components/Toast";
import Highlight from "../../components/Highlight";
import ErrorBoundary from "../../components/ErrorBoundary";
import MarketplaceError from "../../components/MarketplaceError";

function MarketplaceContent() {
  const searchParams = useSearchParams();
  const [filters, setFilters] = useState<FilterState>({
    methodology: "", vintageYear: "", country: "", minPrice: "", maxPrice: "", projectType: "", search: "",
  });

  useEffect(() => {
    const vintage = searchParams.get("vintage");
    if (vintage) setFilters(prev => ({ ...prev, vintageYear: vintage }));
  }, [searchParams]);

  const { data: listings, isLoading, error, mutate } = useListings({
    methodology:  filters.methodology  || undefined,
    vintage:      filters.vintageYear  ? Number(filters.vintageYear) : undefined,
    country:      filters.country      || undefined,
    minPrice:     filters.minPrice     || undefined,
    maxPrice:     filters.maxPrice     || undefined,
    projectType:  filters.projectType  || undefined,
    search:       filters.search       || undefined,
  });

  // Check if any filters are active
  const hasActiveFilters = Object.values(filters).some(v => v !== "");

  useEffect(() => {
    if (error) console.error("[Marketplace] listings fetch failed:", error);
  }, [error]);

  const { addItem, items } = useCartStore();
  const { toasts, addToast, dismiss } = useToast();

  function handleAddToCart(listing: MarketListing) {
    addItem(listing, 1);
    addToast({ type: "success", title: "Added to cart", message: listing.projectName || listing.projectId });
  }

  const cartCount = items.length;

  return (
    <ErrorBoundary>
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.25rem" }}>
              Carbon Marketplace
            </h1>
            <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: 0 }}>
              Browse verified carbon credits from certified projects
            </p>
          </div>
          <a
            href="/buy/cart"
            style={{
              display: "flex", alignItems: "center", gap: "0.5rem",
              background: cartCount > 0 ? colors.primary[600] : colors.neutral[100],
              color: cartCount > 0 ? "#fff" : colors.neutral[600],
              border: "none", borderRadius: "0.5rem",
              padding: "0.6rem 1rem", fontSize: "0.875rem", fontWeight: 600,
              textDecoration: "none", cursor: "pointer",
            }}
          >
            🛒 Cart{cartCount > 0 ? ` (${cartCount})` : ""}
          </a>
        </div>

        <MarketplaceFilter filters={filters} onChange={setFilters} />

        <div aria-live="polite">
          {error ? (
            <MarketplaceError error={error} onRetry={() => mutate()} />
          ) : isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}>
              <LoadingSkeleton variant="MarketplaceItem" count={6} />
            </div>
          ) : !listings?.length ? (
            <div style={{ textAlign: "center", padding: "4rem 2rem", background: colors.surfaceAlt, borderRadius: "1rem", marginTop: "1.5rem" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
              <p style={{ color: colors.neutral[900], fontWeight: 700, fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
                {hasActiveFilters ? "No credits match your filters" : "No listings available yet"}
              </p>
              <p style={{ color: colors.neutral[500], fontSize: "0.875rem", marginBottom: "2rem" }}>
                {hasActiveFilters 
                  ? "Try adjusting your search or clear filters to see all available credits" 
                  : "Check back later for new carbon credit listings"}
              </p>
              {hasActiveFilters && (
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  style={{
                    padding: "0.75rem 1.5rem",
                    border: "none",
                    borderRadius: "0.5rem",
                    background: colors.primary[600],
                    color: "#fff",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="marketplace-listings" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}>
              <style>{`
                @media (min-width: 640px) {
                  .marketplace-listings {
                    display: grid !important;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 1rem;
                  }
                }
                @media (min-width: 1024px) {
                  .marketplace-listings {
                    grid-template-columns: repeat(3, 1fr);
                  }
                }
              `}</style>
              {listings.map(listing => {
                const inCart = items.some(i => i.listing.listingId === listing.listingId);
                return (
                  <div key={listing.listingId} style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto auto",
                    alignItems: "center",
                    gap: "1rem",
                    background: colors.surface,
                    border: `1px solid ${inCart ? colors.primary[300] : colors.neutral[200]}`,
                    borderRadius: "0.75rem",
                    padding: "1rem 1.25rem",
                  }}>
                    {/* Project info */}
                    <div>
                      <p style={{ fontWeight: 700, fontSize: "0.95rem", color: colors.neutral[900], margin: "0 0 0.2rem" }}>
                        <Highlight text={listing.projectName || listing.projectId} query={filters.search} />
                      </p>
                      <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: 0 }}>
                        <Highlight text={listing.country} query={filters.search} /> · <Highlight text={listing.methodology} query={filters.search} /> · {listing.vintageYear} Vintage · {formatTonnes(listing.amountAvailable)} available
                      </p>
                    </div>

                    {/* Price */}
                    <div style={{ textAlign: "right" }}>
                      <p style={{ fontWeight: 700, color: colors.primary[700], fontSize: "1rem", margin: 0 }}>
                        ${formatStroops(listing.pricePerCredit)}
                      </p>
                      <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: 0 }}>per tCO₂e</p>
                    </div>

                    {/* Actions */}
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <a
                        href={`/buy?listing=${listing.listingId}`}
                        style={{
                          padding: "0.5rem 0.875rem", fontSize: "0.8rem", fontWeight: 600,
                          border: `1px solid ${colors.primary[300]}`, borderRadius: "0.375rem",
                          color: colors.primary[700], textDecoration: "none", background: colors.primary[50],
                        }}
                      >
                        Buy now
                      </a>
                      <button
                        onClick={() => handleAddToCart(listing)}
                        disabled={inCart}
                        style={{
                          padding: "0.5rem 0.875rem", fontSize: "0.8rem", fontWeight: 600,
                          border: "none", borderRadius: "0.375rem", cursor: inCart ? "default" : "pointer",
                          background: inCart ? colors.primary[100] : colors.primary[600],
                          color: inCart ? colors.primary[700] : "#fff",
                        }}
                      >
                        {inCart ? "In cart ✓" : "+ Cart"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Toast toasts={toasts} onDismiss={dismiss} />
      </div>
    </ErrorBoundary>
  );
}

export default function MarketplacePage() {
  return (
    <Suspense fallback={
      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "1.5rem" }}>
          {Array.from({ length: 9 }).map((_, i) => <LoadingSkeleton key={i} variant="CreditCard" />)}
        </div>
      </div>
    }>
      <MarketplaceContent />
    </Suspense>
  );
}
