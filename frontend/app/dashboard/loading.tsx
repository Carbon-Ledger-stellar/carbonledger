/**
 * Dashboard Portfolio Page — Progressive Loading
 *
 * Issue #627: Next.js 14 App Router `loading.tsx` wraps the page segment in a
 * Suspense boundary and renders this skeleton while data fetches in-flight.
 * Above-the-fold content (4 stat cards) is skeletonised first; activity feed
 * below the fold loads second.
 *
 * CLS mitigation: every skeleton placeholder matches the exact pixel dimensions
 * of the real card it replaces so layout does not shift when data arrives.
 */

import LoadingSkeleton from "../../components/LoadingSkeleton";

export default function DashboardLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading portfolio dashboard"
      style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}
    >
      {/* ── Page heading placeholder ───────────────────────────────────────── */}
      <div
        style={{
          height: "36px",
          width: "200px",
          background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "6px",
          marginBottom: "28px",
        }}
      />

      {/* ── Above-the-fold: 4 stat cards ──────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <LoadingSkeleton variant="PoolStats" count={4} />
      </div>

      {/* ── Section heading: Recent Activity ──────────────────────────────── */}
      <div
        style={{
          height: "22px",
          width: "160px",
          background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "4px",
          marginBottom: "16px",
        }}
      />

      {/* ── Below-the-fold: activity rows ─────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        <LoadingSkeleton variant="AuditItem" count={5} />
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
