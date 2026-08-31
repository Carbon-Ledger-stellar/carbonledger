"use client";

/**
 * RefinementPanel — Faceted search refinements for the Marketplace.
 *
 * Provides:
 *  - Dual-handle range slider for Price (0–1000 USDC/tCO₂)
 *  - Dual-handle range slider for Carbon Reduction amount (0–1,000,000 tCO₂)
 *  - Vintage year range picker (min/max selects, 2015–2025)
 *  - Multi-select verifier chips (Verra, Gold Standard, ACR, CAR)
 *  - All state is persisted in URL query params
 *  - "Clear all filters" button resets everything and clears the URL
 *
 * Issue: #1031 — Build Advanced Filtering with Refinement
 */

import { useCallback, useRef, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { colors } from "../styles/design-system";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RefinementState {
  /** Price range in USDC per tCO₂ */
  priceMin: number;
  priceMax: number;
  /** Carbon reduction range in tCO₂ */
  carbonMin: number;
  carbonMax: number;
  /** Vintage year range */
  vintageMin: number;
  vintageMax: number;
  /** Selected verifiers (empty array = all) */
  verifiers: string[];
}

export const VERIFIERS = ["Verra", "Gold Standard", "ACR", "CAR"] as const;

const PRICE_MIN_DEFAULT = 0;
const PRICE_MAX_DEFAULT = 1000;
const CARBON_MIN_DEFAULT = 0;
const CARBON_MAX_DEFAULT = 1_000_000;
const VINTAGE_MIN_DEFAULT = 2015;
const VINTAGE_MAX_DEFAULT = new Date().getFullYear();
const VINTAGE_OPTIONS = Array.from(
  { length: VINTAGE_MAX_DEFAULT - VINTAGE_MIN_DEFAULT + 1 },
  (_, i) => VINTAGE_MIN_DEFAULT + i
);

export const EMPTY_REFINEMENTS: RefinementState = {
  priceMin: PRICE_MIN_DEFAULT,
  priceMax: PRICE_MAX_DEFAULT,
  carbonMin: CARBON_MIN_DEFAULT,
  carbonMax: CARBON_MAX_DEFAULT,
  vintageMin: VINTAGE_MIN_DEFAULT,
  vintageMax: VINTAGE_MAX_DEFAULT,
  verifiers: [],
};

export function refinementsFromParams(params: URLSearchParams): RefinementState {
  const n = (key: string, fallback: number) => {
    const raw = params.get(key);
    const val = raw !== null ? Number(raw) : NaN;
    return Number.isFinite(val) ? val : fallback;
  };
  const verifiersRaw = params.get("verifiers");
  const verifiers = verifiersRaw
    ? verifiersRaw.split(",").filter(v => (VERIFIERS as readonly string[]).includes(v))
    : [];

  return {
    priceMin:   n("priceMin",   PRICE_MIN_DEFAULT),
    priceMax:   n("priceMax",   PRICE_MAX_DEFAULT),
    carbonMin:  n("carbonMin",  CARBON_MIN_DEFAULT),
    carbonMax:  n("carbonMax",  CARBON_MAX_DEFAULT),
    vintageMin: n("vintageMin", VINTAGE_MIN_DEFAULT),
    vintageMax: n("vintageMax", VINTAGE_MAX_DEFAULT),
    verifiers,
  };
}

export function refinementsToParams(state: RefinementState): Record<string, string> {
  const params: Record<string, string> = {};
  if (state.priceMin !== PRICE_MIN_DEFAULT)   params.priceMin   = String(state.priceMin);
  if (state.priceMax !== PRICE_MAX_DEFAULT)   params.priceMax   = String(state.priceMax);
  if (state.carbonMin !== CARBON_MIN_DEFAULT) params.carbonMin  = String(state.carbonMin);
  if (state.carbonMax !== CARBON_MAX_DEFAULT) params.carbonMax  = String(state.carbonMax);
  if (state.vintageMin !== VINTAGE_MIN_DEFAULT) params.vintageMin = String(state.vintageMin);
  if (state.vintageMax !== VINTAGE_MAX_DEFAULT) params.vintageMax = String(state.vintageMax);
  if (state.verifiers.length > 0)             params.verifiers  = state.verifiers.join(",");
  return params;
}

export function isRefinementsEmpty(state: RefinementState): boolean {
  return (
    state.priceMin === PRICE_MIN_DEFAULT &&
    state.priceMax === PRICE_MAX_DEFAULT &&
    state.carbonMin === CARBON_MIN_DEFAULT &&
    state.carbonMax === CARBON_MAX_DEFAULT &&
    state.vintageMin === VINTAGE_MIN_DEFAULT &&
    state.vintageMax === VINTAGE_MAX_DEFAULT &&
    state.verifiers.length === 0
  );
}

// ---------------------------------------------------------------------------
// Dual-handle range slider
// ---------------------------------------------------------------------------

interface RangeSliderProps {
  id: string;
  label: string;
  min: number;
  max: number;
  valueMin: number;
  valueMax: number;
  step?: number;
  formatValue?: (v: number) => string;
  onChange: (min: number, max: number) => void;
}

function RangeSlider({
  id,
  label,
  min,
  max,
  valueMin,
  valueMax,
  step = 1,
  formatValue = String,
  onChange,
}: RangeSliderProps) {
  // Percentage helpers
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.min(Number(e.target.value), valueMax - step);
    onChange(v, valueMax);
  };
  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(Number(e.target.value), valueMin + step);
    onChange(valueMin, v);
  };

  const trackFillLeft = pct(valueMin);
  const trackFillWidth = pct(valueMax) - pct(valueMin);

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600] }}>{label}</span>
        <span style={{ fontSize: "0.75rem", color: colors.neutral[500] }}>
          {formatValue(valueMin)} – {formatValue(valueMax)}
        </span>
      </div>

      {/* Track container */}
      <div style={{ position: "relative", height: "1.5rem", display: "flex", alignItems: "center" }}>
        {/* Background track */}
        <div
          style={{
            position: "absolute",
            left: 0, right: 0,
            height: "4px",
            background: colors.neutral[200],
            borderRadius: "2px",
            zIndex: 0,
          }}
        />
        {/* Filled range */}
        <div
          style={{
            position: "absolute",
            left: `${trackFillLeft}%`,
            width: `${trackFillWidth}%`,
            height: "4px",
            background: colors.primary[500],
            borderRadius: "2px",
            zIndex: 1,
            pointerEvents: "none",
          }}
        />

        {/* Min thumb */}
        <input
          id={`${id}-min`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMin}
          onChange={handleMinChange}
          aria-label={`${label} minimum`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={valueMin}
          aria-valuetext={formatValue(valueMin)}
          style={{
            position: "absolute",
            width: "100%",
            height: "4px",
            appearance: "none",
            background: "transparent",
            outline: "none",
            zIndex: 2,
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        />
        {/* Max thumb */}
        <input
          id={`${id}-max`}
          type="range"
          min={min}
          max={max}
          step={step}
          value={valueMax}
          onChange={handleMaxChange}
          aria-label={`${label} maximum`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={valueMax}
          aria-valuetext={formatValue(valueMax)}
          style={{
            position: "absolute",
            width: "100%",
            height: "4px",
            appearance: "none",
            background: "transparent",
            outline: "none",
            zIndex: 3,
            cursor: "pointer",
            pointerEvents: "auto",
          }}
        />
      </div>

      {/* Min/max labels */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem" }}>
        <span style={{ fontSize: "0.7rem", color: colors.neutral[400] }}>{formatValue(min)}</span>
        <span style={{ fontSize: "0.7rem", color: colors.neutral[400] }}>{formatValue(max)}</span>
      </div>

      {/* Inline CSS for range thumb across browsers */}
      <style>{`
        #${id}-min::-webkit-slider-thumb,
        #${id}-max::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--color-primary-600, #16a34a);
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
          cursor: pointer;
        }
        #${id}-min::-moz-range-thumb,
        #${id}-max::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--color-primary-600, #16a34a);
          border: 2px solid #fff;
          box-shadow: 0 1px 4px rgba(0,0,0,0.2);
          cursor: pointer;
        }
        #${id}-min:focus-visible::-webkit-slider-thumb,
        #${id}-max:focus-visible::-webkit-slider-thumb {
          outline: 3px solid #2563eb;
          outline-offset: 2px;
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Verifier multi-select chips
// ---------------------------------------------------------------------------

interface VerifierChipsProps {
  selected: string[];
  onChange: (verifiers: string[]) => void;
}

function VerifierChips({ selected, onChange }: VerifierChipsProps) {
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter(x => x !== v));
    else onChange([...selected, v]);
  };

  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.5rem" }}>
        Verifier
      </span>
      <div
        role="group"
        aria-label="Select verifiers"
        style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}
      >
        {VERIFIERS.map(v => {
          const isSelected = selected.includes(v);
          return (
            <button
              key={v}
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              onClick={() => toggle(v)}
              style={{
                padding: "0.4rem 0.875rem",
                fontSize: "0.8rem",
                fontWeight: 600,
                borderRadius: "9999px",
                border: `1.5px solid ${isSelected ? colors.primary[500] : colors.neutral[300]}`,
                background: isSelected ? colors.primary[50] : colors.surface,
                color: isSelected ? colors.primary[700] : colors.neutral[600],
                cursor: "pointer",
                transition: "all 0.15s ease",
                minHeight: "36px",
              }}
            >
              {isSelected && <span aria-hidden="true" style={{ marginRight: "0.3rem" }}>✓</span>}
              {v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vintage year range — two selects
// ---------------------------------------------------------------------------

interface VintageRangeProps {
  vintageMin: number;
  vintageMax: number;
  onChange: (min: number, max: number) => void;
}

const controlStyle: React.CSSProperties = {
  border: `1px solid ${colors.neutral[300]}`,
  borderRadius: "0.375rem",
  padding: "0.5rem 0.75rem",
  fontSize: "0.875rem",
  color: colors.neutral[700],
  background: colors.surface,
  width: "100%",
  boxSizing: "border-box",
  minHeight: "40px",
};

function VintageRangePicker({ vintageMin, vintageMax, onChange }: VintageRangeProps) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <span style={{ fontSize: "0.75rem", fontWeight: 600, color: colors.neutral[600], display: "block", marginBottom: "0.5rem" }}>
        Vintage Year Range
      </span>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: "0.5rem" }}>
        <div>
          <label htmlFor="refinement-vintage-min" className="sr-only">Vintage year from</label>
          <select
            id="refinement-vintage-min"
            style={controlStyle}
            value={vintageMin}
            onChange={e => {
              const v = Number(e.target.value);
              onChange(v, Math.max(v, vintageMax));
            }}
            aria-label="Vintage year from"
          >
            {VINTAGE_OPTIONS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <span style={{ fontSize: "0.8rem", color: colors.neutral[500], textAlign: "center" }}>to</span>
        <div>
          <label htmlFor="refinement-vintage-max" className="sr-only">Vintage year to</label>
          <select
            id="refinement-vintage-max"
            style={controlStyle}
            value={vintageMax}
            onChange={e => {
              const v = Number(e.target.value);
              onChange(Math.min(vintageMin, v), v);
            }}
            aria-label="Vintage year to"
          >
            {VINTAGE_OPTIONS.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main RefinementPanel component
// ---------------------------------------------------------------------------

interface RefinementPanelProps {
  refinements: RefinementState;
  onChange: (state: RefinementState) => void;
}

export default function RefinementPanel({ refinements, onChange }: RefinementPanelProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  const hasActive = !isRefinementsEmpty(refinements);
  const activeCount = [
    refinements.priceMin !== PRICE_MIN_DEFAULT || refinements.priceMax !== PRICE_MAX_DEFAULT,
    refinements.carbonMin !== CARBON_MIN_DEFAULT || refinements.carbonMax !== CARBON_MAX_DEFAULT,
    refinements.vintageMin !== VINTAGE_MIN_DEFAULT || refinements.vintageMax !== VINTAGE_MAX_DEFAULT,
    refinements.verifiers.length > 0,
  ].filter(Boolean).length;

  // Debounced URL sync — avoid pushing to router on every slider tick
  const syncUrl = useCallback(
    (next: RefinementState) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const params = new URLSearchParams(searchParams.toString());
        // Remove all refinement keys first
        ["priceMin","priceMax","carbonMin","carbonMax","vintageMin","vintageMax","verifiers"].forEach(k => params.delete(k));
        // Write non-default values
        const newParams = refinementsToParams(next);
        Object.entries(newParams).forEach(([k, v]) => params.set(k, v));
        router.push(`?${params.toString()}`, { scroll: false });
      }, 250);
    },
    [router, searchParams]
  );

  const update = useCallback(
    (patch: Partial<RefinementState>) => {
      const next = { ...refinements, ...patch };
      onChange(next);
      syncUrl(next);
    },
    [refinements, onChange, syncUrl]
  );

  const clearAll = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onChange(EMPTY_REFINEMENTS);
    const params = new URLSearchParams(searchParams.toString());
    ["priceMin","priceMax","carbonMin","carbonMax","vintageMin","vintageMax","verifiers"].forEach(k => params.delete(k));
    router.push(`?${params.toString()}`, { scroll: false });
  };

  // Escape to close mobile drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const formatPrice = (v: number) => `$${v}`;
  const formatCarbon = (v: number) =>
    v >= 1_000_000 ? "1M tCO₂" : v >= 1000 ? `${(v / 1000).toFixed(0)}k tCO₂` : `${v} tCO₂`;

  const panelContent = (
    <>
      <RangeSlider
        id="refinement-price"
        label="Price (USDC / tCO₂)"
        min={PRICE_MIN_DEFAULT}
        max={PRICE_MAX_DEFAULT}
        step={5}
        valueMin={refinements.priceMin}
        valueMax={refinements.priceMax}
        formatValue={formatPrice}
        onChange={(min, max) => update({ priceMin: min, priceMax: max })}
      />

      <RangeSlider
        id="refinement-carbon"
        label="Carbon Reduction (tCO₂)"
        min={CARBON_MIN_DEFAULT}
        max={CARBON_MAX_DEFAULT}
        step={1000}
        valueMin={refinements.carbonMin}
        valueMax={refinements.carbonMax}
        formatValue={formatCarbon}
        onChange={(min, max) => update({ carbonMin: min, carbonMax: max })}
      />

      <VintageRangePicker
        vintageMin={refinements.vintageMin}
        vintageMax={refinements.vintageMax}
        onChange={(min, max) => update({ vintageMin: min, vintageMax: max })}
      />

      <VerifierChips
        selected={refinements.verifiers}
        onChange={verifiers => update({ verifiers })}
      />

      <button
        type="button"
        onClick={clearAll}
        disabled={!hasActive}
        aria-label="Clear all refinement filters"
        style={{
          width: "100%",
          padding: "0.6rem 1rem",
          border: `1px solid ${hasActive ? colors.neutral[300] : colors.neutral[200]}`,
          borderRadius: "0.5rem",
          background: "transparent",
          color: hasActive ? colors.neutral[600] : colors.neutral[400],
          fontSize: "0.875rem",
          fontWeight: 600,
          cursor: hasActive ? "pointer" : "default",
          marginTop: "0.5rem",
        }}
      >
        ✕ Clear all filters
      </button>
    </>
  );

  return (
    <>
      {/* Mobile trigger */}
      <div className="refinement-mobile-trigger">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label={activeCount > 0 ? `Refinements, ${activeCount} active` : "Refinements"}
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
            minHeight: "44px",
          }}
        >
          🎛 Refine
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
        {hasActive && (
          <button
            type="button"
            onClick={clearAll}
            style={{ fontSize: "0.8rem", color: colors.neutral[500], background: "none", border: "none", cursor: "pointer", padding: "0 0.25rem", minHeight: "44px" }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Desktop: vertical panel */}
      <aside
        className="refinement-desktop-panel"
        aria-label="Refinement filters"
        style={{
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem",
          padding: "1.25rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
          <h3 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 700, color: colors.neutral[700] }}>
            🎛 Refine Results
          </h3>
          {hasActive && (
            <span style={{
              background: colors.primary[100], color: colors.primary[700],
              borderRadius: "9999px", fontSize: "0.7rem",
              padding: "0.15rem 0.5rem", fontWeight: 700,
            }}>
              {activeCount} active
            </span>
          )}
        </div>
        {panelContent}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Refinement filters"
          style={{
            position: "fixed", inset: 0, zIndex: 110,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "flex-end",
          }}
          onClick={e => { if (e.target === e.currentTarget) setMobileOpen(false); }}
        >
          <div
            ref={drawerRef}
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
              <h2 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: colors.neutral[900] }}>
                🎛 Refine Results
              </h2>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close refinement filters"
                style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: colors.neutral[600], minHeight: "44px", minWidth: "44px" }}
              >
                ✕
              </button>
            </div>
            {panelContent}
            <button
              onClick={() => setMobileOpen(false)}
              style={{
                width: "100%", marginTop: "1rem", padding: "0.75rem",
                border: "none", borderRadius: "0.5rem",
                background: colors.primary[600], color: "#fff",
                fontSize: "0.875rem", fontWeight: 600, cursor: "pointer",
                minHeight: "48px",
              }}
            >
              {activeCount > 0 ? `Apply Refinements (${activeCount})` : "Apply"}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .refinement-mobile-trigger { display: none; }
        .refinement-desktop-panel { display: block; }
        @media (max-width: 767px) {
          .refinement-mobile-trigger { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem; }
          .refinement-desktop-panel { display: none; }
        }
      `}</style>
    </>
  );
}
