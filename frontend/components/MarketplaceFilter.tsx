"use client";

import { useCallback, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { colors } from "../styles/design-system";

export interface FilterState {
  methodology:  string;
  vintageYear:  string;
  country:      string;
  minPrice:     string;
  maxPrice:     string;
  projectType:  string;
  search:       string;
}

export const EMPTY_FILTERS: FilterState = {
  methodology: "", vintageYear: "", country: "",
  minPrice: "", maxPrice: "", projectType: "", search: "",
};

export function filtersFromParams(params: URLSearchParams): FilterState {
  return {
    methodology: params.get("methodology") ?? "",
    vintageYear: params.get("vintageYear")  ?? "",
    country:     params.get("country")      ?? "",
    minPrice:    params.get("minPrice")     ?? "",
    maxPrice:    params.get("maxPrice")     ?? "",
    projectType: params.get("projectType")  ?? "",
    search:      params.get("search")       ?? "",
  };
}

interface Props {
  filters:      FilterState;
  onChange:     (filters: FilterState) => void;
  resultCount?: number;
}

const METHODOLOGIES  = ["", "VCS", "Gold Standard", "ACR", "CAR", "Plan Vivo"];
const COUNTRIES      = ["", "Brazil", "Indonesia", "Kenya", "India", "Colombia", "Peru", "USA"];
const VINTAGES       = ["", "2019", "2020", "2021", "2022", "2023", "2024"];

const controlStyle: React.CSSProperties = {
  border: `1px solid ${colors.neutral[300]}`,
  borderRadius: "0.375rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  color: colors.neutral[700],
  background: colors.surface,
  width: "100%",
  boxSizing: "border-box",
};

function FilterFields({ filters, onChange }: { filters: FilterState; onChange: (k: keyof FilterState, v: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
      <div>
        <label htmlFor="filter-methodology" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>Methodology</label>
        <select id="filter-methodology" style={controlStyle} value={filters.methodology} onChange={e => onChange("methodology", e.target.value)} aria-label="Filter by methodology">
          {METHODOLOGIES.map(m => <option key={m} value={m}>{m || "All"}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="filter-vintage" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>Vintage Year</label>
        <select id="filter-vintage" style={controlStyle} value={filters.vintageYear} onChange={e => onChange("vintageYear", e.target.value)} aria-label="Filter by vintage year">
          {VINTAGES.map(v => <option key={v} value={v}>{v || "All"}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="filter-country" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>Country</label>
        <select id="filter-country" style={controlStyle} value={filters.country} onChange={e => onChange("country", e.target.value)} aria-label="Filter by country">
          {COUNTRIES.map(c => <option key={c} value={c}>{c || "All"}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="filter-min-price" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>Min Price (USDC)</label>
        <input id="filter-min-price" type="number" style={controlStyle} placeholder="0" value={filters.minPrice} onChange={e => onChange("minPrice", e.target.value)} min="0" aria-label="Minimum price in USDC" />
      </div>
      <div>
        <label htmlFor="filter-max-price" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>Max Price (USDC)</label>
        <input id="filter-max-price" type="number" style={controlStyle} placeholder="Any" value={filters.maxPrice} onChange={e => onChange("maxPrice", e.target.value)} min="0" aria-label="Maximum price in USDC" />
      </div>
    </div>
  );
}

export default function MarketplaceFilter({ filters, onChange, resultCount }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localSearch, setLocalSearch] = useState(filters.search);
  const [mobileOpen, setMobileOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const activeCount = Object.entries(filters).filter(([k, v]) => k !== "search" && v !== "").length;

  const handleFilterChange = useCallback((key: keyof FilterState, value: string) => {
    const newFilters = { ...filters, [key]: value };
    onChange(newFilters);
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [filters, onChange, router, searchParams]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (localSearch !== filters.search) handleFilterChange("search", localSearch);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [localSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close modal on Escape
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const handleClear = () => {
    setLocalSearch("");
    onChange(EMPTY_FILTERS);
    router.push("?", { scroll: false });
  };

  return (
    <>
      {/* Search — always visible */}
      <div style={{ position: "relative", marginBottom: "1rem" }}>
        <label htmlFor="filter-search" className="sr-only">Search by project name, methodology, or country</label>
        <input
          id="filter-search"
          type="search"
          placeholder="Search by project name, methodology, or country…"
          value={localSearch}
          onChange={e => setLocalSearch(e.target.value)}
          aria-label="Search credits"
          style={{
            ...controlStyle,
            padding: "0.75rem 1rem 0.75rem 2.5rem",
            fontSize: "1rem",
            borderRadius: "0.75rem",
            boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
          }}
        />
        <span aria-hidden="true" style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: colors.neutral[400] }}>🔍</span>
      </div>

      {/* Mobile: Filters toggle button */}
      <div className="mobile-filter-bar" style={{ display: "none", gap: "0.75rem", marginBottom: "1rem", alignItems: "center" }}>
        <button
          onClick={() => setMobileOpen(true)}
          aria-label={`Open filters${activeCount > 0 ? `, ${activeCount} active` : ""}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.5rem",
            border: `1px solid ${activeCount > 0 ? colors.primary[400] : colors.neutral[300]}`,
            borderRadius: "0.5rem",
            padding: "0.6rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            background: activeCount > 0 ? colors.primary[50] : colors.surface,
            color: activeCount > 0 ? colors.primary[700] : colors.neutral[700],
            cursor: "pointer",
          }}
        >
          ⚙ Filters
          {activeCount > 0 && (
            <span style={{
              background: colors.primary[600], color: "#fff",
              borderRadius: "9999px", fontSize: "0.7rem",
              padding: "0 0.4rem", lineHeight: "1.4rem", fontWeight: 700,
            }}>
              {activeCount}
            </span>
          )}
        </button>
        {activeCount > 0 && (
          <button onClick={handleClear} style={{ fontSize: "0.8rem", color: colors.neutral[500], background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            Clear
          </button>
        )}
      </div>

      {/* Desktop: inline filter panel */}
      <fieldset className="desktop-filters" style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: "0.75rem",
        padding: "1.25rem",
        margin: "0 0 1rem",
      }}>
        <legend style={{ fontSize: "0.75rem", fontWeight: 700, color: colors.neutral[600], padding: "0 0.25rem", float: "left", width: "100%", marginBottom: "0.5rem" }}>
          Filter Credits
        </legend>
        <FilterFields filters={filters} onChange={handleFilterChange} />
        <div style={{ marginTop: "1rem", textAlign: "right" }}>
          <button type="button" onClick={handleClear} aria-label="Clear all filters" style={{
            background: "transparent", color: colors.neutral[500],
            border: `1px solid ${colors.neutral[300]}`, borderRadius: "0.375rem",
            padding: "0.5rem 1rem", fontSize: "0.8rem", cursor: "pointer",
          }}>
            Clear Filters
          </button>
        </div>
      </fieldset>

      {/* Mobile filter modal */}
      {mobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Filters"
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "flex-end",
          }}
          onClick={e => { if (e.target === e.currentTarget) setMobileOpen(false); }}
        >
          <div
            ref={modalRef}
            style={{
              background: colors.surface,
              borderRadius: "1rem 1rem 0 0",
              padding: "1.5rem",
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: colors.neutral[900] }}>Filters</h2>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close filters"
                style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: colors.neutral[600] }}
              >
                ✕
              </button>
            </div>

            <FilterFields filters={filters} onChange={handleFilterChange} />

            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.5rem" }}>
              <button onClick={handleClear} style={{
                flex: 1, padding: "0.75rem", border: `1px solid ${colors.neutral[300]}`,
                borderRadius: "0.5rem", background: "transparent", color: colors.neutral[700],
                fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
              }}>
                Clear All
              </button>
              <button onClick={() => setMobileOpen(false)} style={{
                flex: 1, padding: "0.75rem", border: "none",
                borderRadius: "0.5rem", background: colors.primary[600], color: "#fff",
                fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
              }}>
                Apply Filters{activeCount > 0 ? ` (${activeCount})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 767px) {
          .mobile-filter-bar { display: flex !important; }
          .desktop-filters { display: none !important; }
        }
      `}</style>
    </>
  );
}
