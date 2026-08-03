/**
 * Project Detail Page — Progressive Loading
 *
 * Issue #627: Next.js 14 `loading.tsx` for the `/projects/[id]` segment.
 * Above-the-fold content (header + stats panel) is prioritised; the map,
 * oracle status widget, and provenance trail load below the fold.
 *
 * CLS mitigation: placeholder dimensions match the real content to prevent
 * layout shift.  The header shimmer is 32 px tall × 40 % width to mirror the
 * h1 heading; stat cells are 80 × 16 px inline blocks.
 */

import LoadingSkeleton from "../../../../components/LoadingSkeleton";

export default function ProjectDetailLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading project details"
      style={{ maxWidth: "1000px", margin: "0 auto", padding: "2.5rem 2rem" }}
    >
      {/* ── Breadcrumb placeholder ─────────────────────────────────────────── */}
      <div
        style={{
          height: "14px",
          width: "120px",
          background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "4px",
          marginBottom: "20px",
        }}
      />

      {/* ── Header: project name + status badge ───────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
          gap: "16px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
          {/* Project name */}
          <div
            style={{
              height: "32px",
              width: "40%",
              background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite",
              borderRadius: "4px",
            }}
          />
          {/* Sub-heading line */}
          <div
            style={{
              height: "16px",
              width: "60%",
              background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
              backgroundSize: "200% 100%",
              animation: "shimmer 1.5s infinite",
              borderRadius: "4px",
            }}
          />
        </div>
        {/* Status badge */}
        <div
          style={{
            height: "28px",
            width: "90px",
            background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite",
            borderRadius: "9999px",
            flexShrink: 0,
          }}
        />
      </div>

      {/* ── Above-the-fold: key stats row ─────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: "16px",
          marginBottom: "32px",
        }}
      >
        <LoadingSkeleton variant="PoolStats" count={4} />
      </div>

      {/* ── Map placeholder (below fold) ──────────────────────────────────── */}
      <div
        style={{
          height: "280px",
          width: "100%",
          background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
          backgroundSize: "200% 100%",
          animation: "shimmer 1.5s infinite",
          borderRadius: "8px",
          marginBottom: "32px",
        }}
      />

      {/* ── Credit batches / provenance trail (below fold) ────────────────── */}
      <LoadingSkeleton variant="ProvenanceTrail" count={1} />

      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
    </div>
  );
}
