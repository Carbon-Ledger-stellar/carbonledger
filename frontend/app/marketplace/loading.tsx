/**
 * Marketplace Listing Page — Progressive Loading
 *
 * Issue #627: Next.js 14 App Router `loading.tsx` automatically wraps the page
 * in a Suspense boundary and renders this component while the page segment is
 * being loaded.  Above-the-fold content (filter bar + first 4 listing cards)
 * is rendered with skeleton placeholders within 200 ms of navigation.
 *
 * CLS mitigation: every skeleton exactly mirrors the dimensions of the real
 * content it replaces, preventing layout shift when data arrives.
 */

import LoadingSkeleton from "../../components/LoadingSkeleton";

export default function MarketplaceLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading marketplace listings"
      style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}
    >
      {/* ── Page header placeholder ────────────────────────────────────────── */}
      <div
        style={{
          height: "40px",
          width: "260px",
          background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "6px",
          marginBottom: "24px",
        }}
      />

      {/* ── Filter bar placeholder ─────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "12px",
          marginBottom: "24px",
          flexWrap: "wrap",
        }}
      >
        {[180, 120, 140, 120].map((w, i) => (
          <div
            key={i}
            style={{
              height: "40px",
              width: `${w}px`,
              background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite",
              borderRadius: "6px",
            }}
          />
        ))}
      </div>

      {/* ── Above-the-fold listing cards (4 visible without scroll) ────────── */}
      <LoadingSkeleton variant="MarketplaceItem" count={4} />

      {/* ── Below-the-fold listing cards ───────────────────────────────────── */}
      <div style={{ marginTop: "12px" }}>
        <LoadingSkeleton variant="MarketplaceItem" count={4} />
      </div>

      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
