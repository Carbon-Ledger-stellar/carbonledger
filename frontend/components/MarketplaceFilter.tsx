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

/** Build a FilterState from URLSearchParams. */
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
  filters:  FilterState;
  onChange: (filters: FilterState) => void;
}

const METHODOLOGIES  = ["", "VCS", "Gold Standard", "ACR", "CAR", "Plan Vivo"];
const COUNTRIES      = ["", "Brazil", "Indonesia", "Kenya", "India", "Colombia", "Peru", "USA"];
const VINTAGES       = ["", "2019", "2020", "2021", "2022", "2023", "2024"];
const PROJECT_TYPES  = ["", "REDD+", "Afforestation", "Soil Carbon", "Renewable Energy", "Methane Capture", "Blue Carbon"];

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

export default function MarketplaceFilter({ filters, onChange }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [localSearch, setLocalSearch] = useState(filters.search);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFilterChange = useCallback((key: keyof FilterState, value: string) => {
    const newFilters = { ...filters, [key]: value };
    onChange(newFilters);
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [filters, onChange, router, searchParams]);

  // Debounced search — fires handleFilterChange after 300 ms of no typing
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (localSearch !== filters.search) {
        handleFilterChange("search", localSearch);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [localSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClear = () => {
    setLocalSearch("");
    onChange(EMPTY_FILTERS);
    router.push("?", { scroll: false });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {/* Search Input */}
      <div style={{ position: "relative" }}>
        <label htmlFor="filter-search" className="sr-only">
          Search by project name, methodology, or country
        </label>
        <input
          id="filter-search"
          type="search"
          placeholder="Search by project name, methodology, or country…"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          aria-label="Search credits"
          style={{
            ...controlStyle,
            padding: "0.75rem 1rem 0.75rem 2.5rem",
            fontSize: "1rem",
            borderRadius: "0.75rem",
            boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
          }}
        />
        <span aria-hidden="true" style={{ position: "absolute", left: "1rem", top: "50%", transform: "translateY(-50%)", color: colors.neutral[400] }}>
          🔍
        </span>
      </div>

      <fieldset style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: "0.75rem",
        padding: "1.25rem",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
        gap: "1rem",
        margin: 0,
      }}>
        <legend style={{
          fontSize: "0.75rem",
          fontWeight: 700,
          color: colors.neutral[600],
          padding: "0 0.25rem",
          float: "left",
          width: "100%",
          marginBottom: "0.5rem",
        }}>
          Filter Credits
        </legend>

        <div>
          <label htmlFor="filter-methodology" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>
            Methodology
          </label>
          <select
            id="filter-methodology"
            style={controlStyle}
            value={filters.methodology}
            onChange={(e) => handleFilterChange("methodology", e.target.value)}
            aria-label="Filter by methodology"
          >
            {METHODOLOGIES.map(m => <option key={m} value={m}>{m || "All"}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="filter-vintage" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>
            Vintage Year
          </label>
          <select
            id="filter-vintage"
            style={controlStyle}
            value={filters.vintageYear}
            onChange={(e) => handleFilterChange("vintageYear", e.target.value)}
            aria-label="Filter by vintage year"
          >
            {VINTAGES.map(v => <option key={v} value={v}>{v || "All"}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="filter-country" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>
            Country
          </label>
          <select
            id="filter-country"
            style={controlStyle}
            value={filters.country}
            onChange={(e) => handleFilterChange("country", e.target.value)}
            aria-label="Filter by country"
          >
            {COUNTRIES.map(c => <option key={c} value={c}>{c || "All"}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="filter-min-price" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>
            Min Price (USDC)
          </label>
          <input
            id="filter-min-price"
            type="number"
            style={controlStyle}
            placeholder="0"
            value={filters.minPrice}
            onChange={(e) => handleFilterChange("minPrice", e.target.value)}
            min="0"
            aria-label="Minimum price in USDC"
          />
        </div>

        <div>
          <label htmlFor="filter-max-price" style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.3rem" }}>
            Max Price (USDC)
          </label>
          <input
            id="filter-max-price"
            type="number"
            style={controlStyle}
            placeholder="Any"
            value={filters.maxPrice}
            onChange={(e) => handleFilterChange("maxPrice", e.target.value)}
            min="0"
            aria-label="Maximum price in USDC"
          />
        </div>

        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear all filters"
            style={{
              background: "transparent",
              color: colors.neutral[500],
              border: `1px solid ${colors.neutral[300]}`,
              borderRadius: "0.375rem",
              padding: "0.5rem 1rem",
              fontSize: "0.8rem",
              cursor: "pointer",
              width: "100%",
            }}
          >
            Clear Filters
          </button>
        </div>
      </fieldset>
    </div>
  );
}
