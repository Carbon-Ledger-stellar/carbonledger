"use client";

import { useCallback } from "react";
import { colors } from "../styles/design-system";
import SearchAutocomplete from "./SearchAutocomplete";

/**
 * ProjectFilter Component (Issue #1025)
 *
 * Provides filtering controls for the project browser:
 * - Search by project name, country, methodology, project type
 * - Filter by methodology (VCS, Gold Standard, ACR, CAR)
 * - Filter by country (Brazil, Indonesia, Kenya, India, Colombia)
 * - Filter by vintage year (2020-2024)
 * - URL parameter synchronization
 * - Mobile responsive layout
 */

export interface FilterState {
  methodology: string;
  country: string;
  vintage: string;
  search: string;
}

const METHODOLOGIES = ["", "VCS", "Gold Standard", "ACR", "CAR"];
const COUNTRIES = ["", "Brazil", "Indonesia", "Kenya", "India", "Colombia"];
const VINTAGES = ["", "2020", "2021", "2022", "2023", "2024"];

interface Props {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  searchSuggestions?: string[];
  resultCount?: number;
}

const selectStyle: React.CSSProperties = {
  border: `1px solid ${colors.neutral[300]}`,
  borderRadius: "0.375rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  color: colors.neutral[700],
  background: colors.surface,
  minHeight: "48px",
};

export default function ProjectFilter({
  filters,
  onChange,
  searchSuggestions = [],
  resultCount,
}: Props) {
  const handleChange = useCallback(
    (field: keyof FilterState, value: string) => {
      onChange({ ...filters, [field]: value });
    },
    [filters, onChange]
  );

  const clearFilters = useCallback(() => {
    onChange({ methodology: "", country: "", vintage: "", search: "" });
  }, [onChange]);

  const hasActiveFilters =
    filters.methodology ||
    filters.country ||
    filters.vintage ||
    filters.search;

  return (
    <div style={{ marginBottom: "2rem" }}>
      {/* Search */}
      <div style={{ marginBottom: "1.25rem" }}>
        <label
          htmlFor="project-search"
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: colors.neutral[600],
            display: "block",
            marginBottom: "0.5rem",
          }}
        >
          Search Projects
        </label>
        <SearchAutocomplete
          id="project-search"
          data-shortcut-target="search"
          value={filters.search}
          onChange={(value) => handleChange("search", value)}
          suggestions={searchSuggestions}
          placeholder="Search by name, country, or methodology…"
          ariaLabel="Search projects"
          inputStyle={{
            ...selectStyle,
            width: "100%",
            padding: "0.6rem 0.9rem 0.6rem 2.3rem",
            fontSize: "0.9rem",
          }}
          leadingIcon={
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "0.75rem",
                top: "50%",
                transform: "translateY(-50%)",
                color: colors.neutral[400],
                zIndex: 1,
              }}
            >
              🔍
            </span>
          }
        />
      </div>

      {/* Filters */}
      <div
        style={{
          display: "flex",
          gap: "1rem",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <div style={{ flex: "1 1 160px", minWidth: "150px" }}>
          <label
            htmlFor="filter-methodology"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: colors.neutral[600],
              display: "block",
              marginBottom: "0.3rem",
            }}
          >
            Methodology
          </label>
          <select
            id="filter-methodology"
            style={{ ...selectStyle, width: "100%" }}
            value={filters.methodology}
            onChange={(e) => handleChange("methodology", e.target.value)}
            aria-label="Filter by methodology"
          >
            {METHODOLOGIES.map((m) => (
              <option key={m} value={m}>
                {m || "All Methodologies"}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: "1 1 160px", minWidth: "150px" }}>
          <label
            htmlFor="filter-country"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: colors.neutral[600],
              display: "block",
              marginBottom: "0.3rem",
            }}
          >
            Country
          </label>
          <select
            id="filter-country"
            style={{ ...selectStyle, width: "100%" }}
            value={filters.country}
            onChange={(e) => handleChange("country", e.target.value)}
            aria-label="Filter by country"
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c || "All Countries"}
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: "1 1 160px", minWidth: "150px" }}>
          <label
            htmlFor="filter-vintage"
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              color: colors.neutral[600],
              display: "block",
              marginBottom: "0.3rem",
            }}
          >
            Vintage Year
          </label>
          <select
            id="filter-vintage"
            style={{ ...selectStyle, width: "100%" }}
            value={filters.vintage}
            onChange={(e) => handleChange("vintage", e.target.value)}
            aria-label="Filter by vintage year"
          >
            {VINTAGES.map((v) => (
              <option key={v} value={v}>
                {v || "All Vintages"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Clear Filters Button & Result Count */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            style={{
              background: "none",
              border: "none",
              color: colors.primary[600],
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: 0,
              textDecoration: "underline",
            }}
            aria-label="Clear all filters"
          >
            Clear Filters
          </button>
        )}
        {resultCount !== undefined && (
          <span
            style={{
              fontSize: "0.875rem",
              color: colors.neutral[500],
              marginLeft: "auto",
            }}
          >
            {resultCount} project{resultCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Mobile responsive styles */}
      <style>{`
        @media (max-width: 639px) {
          [data-filter-row] {
            flex-direction: column;
          }
          [data-filter-row] select {
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}
