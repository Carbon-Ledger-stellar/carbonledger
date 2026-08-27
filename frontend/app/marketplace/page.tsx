"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useListings, useProjectsForMap, MarketListing, ListingSortField, SortOrder } from "../../lib/api";
import { useCartStore } from "../../lib/use-cart-store";
import { formatTonnes } from "../../lib/carbon-utils";
import { useLocaleFormatters } from "../../lib/i18n/format";
import { joinListingsWithProjects } from "../../lib/map-utils";
import { colors } from "../../styles/design-system";
import MarketplaceFilter, { FilterState, EMPTY_FILTERS, filtersFromParams } from "../../components/MarketplaceFilter";
import MarketplaceSortControls from "../../components/MarketplaceSortControls";
import ComparisonTray, { MAX_COMPARISON_ITEMS } from "../../components/ComparisonTray";
import VirtualizedList from "../../components/VirtualizedList";
import LoadingSkeleton from "../../components/LoadingSkeleton";
import Toast, { useToast } from "../../components/Toast";
import Highlight from "../../components/Highlight";
import ErrorBoundary from "../../components/ErrorBoundary";
import MarketplaceError from "../../components/MarketplaceError";
import OrderBookChart from "../../components/OrderBookChart";

// Leaflet touches `window` at import time, so it must never be pulled into
// the server bundle — ssr: false keeps it out entirely.
const ProjectMap = dynamic(() => import("../../components/ProjectMap"), { ssr: false });

const LISTING_ROW_HEIGHT = 96;
const LISTING_VIEWPORT_HEIGHT = 640;

const VALID_SORT_FIELDS: ListingSortField[] = ["price", "vintageYear", "methodology", "verificationDate"];

function MarketplaceContent() {
  const t = useTranslations("marketplace");
  const { formatCurrency } = useLocaleFormatters();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [filters, setFilters] = useState<FilterState>(() => filtersFromParams(searchParams));

  // Sort state lives in the URL so sorted views are shareable/bookmarkable.
  const rawSort = searchParams.get("sort");
  const sortBy: ListingSortField | "" = VALID_SORT_FIELDS.includes(rawSort as ListingSortField) ? (rawSort as ListingSortField) : "";
  const sortOrder: SortOrder = searchParams.get("order") === "desc" ? "desc" : "asc";

  function handleSortChange(nextSortBy: ListingSortField | "", nextSortOrder: SortOrder) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextSortBy) params.set("sort", nextSortBy); else params.delete("sort");
    if (nextSortBy) params.set("order", nextSortOrder); else params.delete("order");
    router.push(`?${params.toString()}`, { scroll: false });
  }

  // refreshInterval defaults to 30s inside useListings — keeps displayed prices well under the 60s staleness bound.
  const { data, isLoading, error, mutate } = useListings({
    methodology:  filters.methodology  || undefined,
    vintage:      filters.vintageYear  ? Number(filters.vintageYear) : undefined,
    country:      filters.country      || undefined,
    minPrice:     filters.minPrice     || undefined,
    maxPrice:     filters.maxPrice     || undefined,
    projectType:  filters.projectType  || undefined,
    search:       filters.search       || undefined,
    sortBy:       sortBy || undefined,
    sortOrder:    sortBy ? sortOrder : undefined,
    limit:        100,
  });
  const listings = data?.listings ?? [];

  // Suggestion pool for the search autocomplete — project names, countries, and
  // methodologies seen in the current listings, deduped. Filtering happens
  // client-side inside SearchAutocomplete, so this stays cheap even with 1000+ listings.
  const searchSuggestions = useMemo(() => {
    const terms = new Set<string>();
    for (const l of listings) {
      if (l.projectName) terms.add(l.projectName);
      if (l.country) terms.add(l.country);
      if (l.methodology) terms.add(l.methodology);
    }
    return Array.from(terms);
  }, [listings]);

  // "Available now" isn't a backend query param — applied client-side here so
  // it's a single source of truth shared by both the listings grid and the map.
  const visibleListings = listings.filter(
    l => filters.availableOnly !== "true" || l.amountAvailable > 0
  );

  // GET /marketplace/listings doesn't include project coordinates, so they're
  // fetched separately and joined client-side for the map (see lib/map-utils.ts).
  const { data: projectsData } = useProjectsForMap({ limit: 100 });
  const { pins, missingCoordinatesCount } = joinListingsWithProjects(
    visibleListings,
    projectsData?.projects ?? []
  );

  // Check if any filters are active
  const hasActiveFilters = Object.values(filters).some(v => v !== "");

  useEffect(() => {
    if (error) console.error("[Marketplace] listings fetch failed:", error);
  }, [error]);

  const { addItem, items } = useCartStore();
  const { toasts, addToast, dismiss } = useToast();

  // Comparison tray selection — capped at MAX_COMPARISON_ITEMS.
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const comparisonListings = useMemo(
    () => visibleListings.filter(l => comparisonIds.includes(l.listingId)),
    [visibleListings, comparisonIds]
  );

  function toggleComparison(listingId: string) {
    setComparisonIds(prev => {
      if (prev.includes(listingId)) return prev.filter(id => id !== listingId);
      if (prev.length >= MAX_COMPARISON_ITEMS) return prev;
      return [...prev, listingId];
    });
  }

  function handleAddToCart(listing: MarketListing) {
    addItem(listing, 1);
    addToast({ type: "success", title: t("addedToCartTitle"), message: listing.projectName || listing.projectId });
  }

  const cartCount = items.length;

  return (
    <ErrorBoundary>
      <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "2.5rem 2rem" }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.5rem" }}>
          <div>
            <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.25rem" }}>
              {t("title")}
            </h1>
            <p style={{ color: colors.neutral[500], fontSize: "0.875rem", margin: 0 }}>
              {t("subtitle")}
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
            🛒 {cartCount > 0 ? t("cartWithCount", { count: cartCount }) : t("cart")}
          </a>
        </div>

        <MarketplaceFilter filters={filters} onChange={setFilters} suggestions={searchSuggestions} />

        <div style={{ marginTop: "1.5rem" }}>
          <OrderBookChart />
        </div>

        {!isLoading && !error && (
          <div style={{ marginTop: "1.5rem" }}>
            <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: colors.neutral[900], margin: "0 0 0.75rem" }}>
              {t("browseByLocation")}
            </h2>
            <ProjectMap pins={pins} />
            {missingCoordinatesCount > 0 && (
              <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: "0.5rem 0 0" }}>
                {t("missingCoordinates", { count: missingCoordinatesCount })}
              </p>
            )}
          </div>
        )}

        <div aria-live="polite">
          {error ? (
            <MarketplaceError error={error} onRetry={() => mutate()} />
          ) : isLoading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}>
              <LoadingSkeleton variant="MarketplaceItem" count={6} />
            </div>
          ) : !visibleListings.length ? (
            <div style={{ textAlign: "center", padding: "4rem 2rem", background: colors.surfaceAlt, borderRadius: "1rem", marginTop: "1.5rem" }}>
              <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🔍</div>
              <p style={{ color: colors.neutral[900], fontWeight: 700, fontSize: "1.25rem", margin: "0 0 0.5rem" }}>
                {hasActiveFilters ? t("noMatchTitle") : t("noListingsTitle")}
              </p>
              <p style={{ color: colors.neutral[500], fontSize: "0.875rem", marginBottom: "2rem" }}>
                {hasActiveFilters ? t("noMatchMessage") : t("noListingsMessage")}
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
                  {t("clearFilters")}
                </button>
              )}
            </div>
          ) : (
            <div style={{ marginTop: "1.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
                <MarketplaceSortControls sortBy={sortBy} sortOrder={sortOrder} onChange={handleSortChange} />
                <span style={{ fontSize: "0.8rem", color: colors.neutral[500] }}>
                  {t("resultsCount", { count: visibleListings.length })}
                </span>
              </div>

              <VirtualizedList
                items={visibleListings}
                itemHeight={LISTING_ROW_HEIGHT}
                height={LISTING_VIEWPORT_HEIGHT}
                getKey={(listing) => listing.listingId}
                renderItem={(listing) => {
                  const inCart = items.some(i => i.listing.listingId === listing.listingId);
                  const inComparison = comparisonIds.includes(listing.listingId);
                  const comparisonDisabled = !inComparison && comparisonIds.length >= MAX_COMPARISON_ITEMS;
                  return (
                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto auto",
                      alignItems: "center",
                      gap: "1rem",
                      background: colors.surface,
                      border: `1px solid ${inCart ? colors.primary[300] : colors.neutral[200]}`,
                      borderRadius: "0.75rem",
                      padding: "1rem 1.25rem",
                      height: LISTING_ROW_HEIGHT - 12,
                      marginBottom: "0.75rem",
                      boxSizing: "border-box",
                      overflow: "hidden",
                    }}>
                      <label
                        style={{ display: "flex", alignItems: "center", cursor: comparisonDisabled ? "not-allowed" : "pointer" }}
                        title={t("compareCheckboxLabel")}
                      >
                        <input
                          type="checkbox"
                          checked={inComparison}
                          disabled={comparisonDisabled}
                          onChange={() => toggleComparison(listing.listingId)}
                          aria-label={t("compareCheckboxAria", { project: listing.projectName || listing.projectId })}
                        />
                      </label>

                      {/* Project info */}
                      <div style={{ overflow: "hidden" }}>
                        <p style={{ fontWeight: 700, fontSize: "0.95rem", color: colors.neutral[900], margin: "0 0 0.2rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <Highlight text={listing.projectName || listing.projectId} query={filters.search} />
                        </p>
                        <p style={{ fontSize: "0.75rem", color: colors.neutral[500], margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          <Highlight text={listing.country} query={filters.search} /> · <Highlight text={listing.methodology} query={filters.search} /> · {t("vintageLabel", { year: listing.vintageYear })} · {t("availableLabel", { amount: formatTonnes(listing.amountAvailable) })}
                        </p>
                      </div>

                      {/* Price */}
                      <div style={{ textAlign: "right" }}>
                        <p style={{ fontWeight: 700, color: colors.primary[700], fontSize: "1rem", margin: 0 }}>
                          ${formatCurrency(listing.pricePerCredit)}
                        </p>
                        <p style={{ fontSize: "0.7rem", color: colors.neutral[400], margin: 0 }}>{t("perTonne")}</p>
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
                          {t("buyNow")}
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
                          {inCart ? t("inCart") : t("addToCart")}
                        </button>
                      </div>
                    </div>
                  );
                }}
              />

              <ComparisonTray
                selected={comparisonListings}
                onRemove={(id) => setComparisonIds(prev => prev.filter(x => x !== id))}
                onClear={() => setComparisonIds([])}
              />
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
