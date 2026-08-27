"use client";

import { colors } from "../styles/design-system";

type Variant = "CreditCard" | "MarketplaceItem" | "PoolStats" | "LoanCard" | "ProjectCard" | "ProvenanceTrail" | "Certificate" | "AuditItem" | "PricingTable" | "Table";

interface Props {
  variant?: Variant;
  count?: number;
  className?: string;
  /** Only used by the "Table" variant — number of shimmer cells per row. Defaults to 4. */
  columns?: number;
}

function Shimmer({ width, height, borderRadius = "0.375rem" }: { width: string; height: string; borderRadius?: string }) {
  return (
    <div style={{
      width,
      height,
      borderRadius,
      background: `linear-gradient(90deg, ${colors.neutral[100]} 25%, ${colors.neutral[200]} 50%, ${colors.neutral[100]} 75%)`,
      backgroundSize: "200% 100%",
      animation: "shimmer 1.5s infinite",
    }} />
  );
}

function CreditCardSkeleton() {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.75rem",
      padding: "1.5rem",
      display: "flex",
      flexDirection: "column",
      gap: "1rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <Shimmer width="80px" height="12px" />
          <Shimmer width="160px" height="18px" />
        </div>
        <Shimmer width="60px" height="22px" borderRadius="9999px" />
      </div>
      <Shimmer width="80px" height="22px" borderRadius="0.375rem" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <Shimmer width="60px" height="10px" />
          <Shimmer width="100px" height="16px" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          <Shimmer width="80px" height="10px" />
          <Shimmer width="90px" height="16px" />
        </div>
      </div>
      <Shimmer width="100%" height="36px" borderRadius="0.5rem" />
    </div>
  );
}

// Mirrors the real listing row in app/marketplace/page.tsx (checkbox + project
// info + price + action buttons) so there's no layout shift when data arrives —
// same grid columns, height, padding and border-radius as the live row.
function MarketplaceItemSkeleton() {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto auto",
      alignItems: "center",
      gap: "1rem",
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.75rem",
      padding: "1rem 1.25rem",
      height: "84px",
      marginBottom: "0.75rem",
      boxSizing: "border-box",
      overflow: "hidden",
    }}>
      <Shimmer width="16px" height="16px" borderRadius="0.25rem" />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", overflow: "hidden" }}>
        <Shimmer width="55%" height="15px" />
        <Shimmer width="80%" height="12px" />
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.3rem" }}>
        <Shimmer width="70px" height="16px" />
        <Shimmer width="50px" height="10px" />
      </div>

      <div style={{ display: "flex", gap: "0.5rem" }}>
        <Shimmer width="78px" height="30px" borderRadius="0.375rem" />
        <Shimmer width="92px" height="30px" borderRadius="0.375rem" />
      </div>
    </div>
  );
}

function PoolStatsSkeleton() {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.75rem",
      padding: "1.5rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
    }}>
      <Shimmer width="120px" height="14px" />
      <Shimmer width="80px" height="32px" />
      <Shimmer width="160px" height="12px" />
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.75rem",
      padding: "1.5rem",
      display: "flex",
      flexDirection: "column",
      gap: "0.75rem",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <Shimmer width="100px" height="12px" />
        <Shimmer width="60px" height="18px" borderRadius="9999px" />
      </div>
      <Shimmer width="70%" height="20px" />
      <Shimmer width="50%" height="14px" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1rem", marginTop: "0.5rem" }}>
        {[1, 2, 3].map(i => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <Shimmer width="40px" height="10px" />
            <Shimmer width="60px" height="16px" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProvenanceTrailSkeleton() {
  return (
    <div style={{ position: "relative", paddingLeft: "2rem" }}>
      <div style={{
        position: "absolute", left: "0.6rem", top: 0, bottom: 0,
        width: "2px", background: colors.primary[100],
      }} />
      {[1, 2, 3].map(i => (
        <div key={i} style={{ position: "relative", marginBottom: "1.5rem" }}>
          <div style={{
            position: "absolute", left: "-1.65rem", top: "0.1rem",
            width: "1.25rem", height: "1.25rem",
            background: colors.neutral[200], borderRadius: "50%",
            border: "2px solid white",
          }} />
          <div style={{
            background: colors.surface,
            border: `1px solid ${colors.neutral[200]}`,
            borderRadius: "0.5rem",
            padding: "0.75rem 1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Shimmer width="120px" height="14px" />
              <Shimmer width="80px" height="12px" />
            </div>
            <Shimmer width="80%" height="12px" />
          </div>
        </div>
      ))}
    </div>
  );
}

function AuditItemSkeleton() {
  return (
    <div style={{
      background: colors.surface,
      border: `1px solid ${colors.neutral[200]}`,
      borderRadius: "0.5rem",
      padding: "1rem",
      display: "grid",
      gridTemplateColumns: "1fr 1fr 1fr auto",
      gap: "1rem",
      alignItems: "center",
    }}>
      {[100, 120, 80, 40].map((w, i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <Shimmer width="40px" height="10px" />
          <Shimmer width={`${w}px`} height="16px" />
        </div>
      ))}
    </div>
  );
}

function CertificateSkeleton() {
  return (
    <div style={{
      background: "#fff",
      border: `3px solid ${colors.primary[100]}`,
      borderRadius: "1rem",
      padding: "3rem",
      maxWidth: "900px",
      margin: "0 auto",
      display: "flex",
      flexDirection: "column",
      gap: "2rem",
    }}>
      <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
        <Shimmer width="40px" height="40px" borderRadius="50%" />
        <Shimmer width="150px" height="16px" />
        <Shimmer width="300px" height="28px" />
        <Shimmer width="200px" height="14px" />
      </div>
      <div style={{ textAlign: "center", padding: "2rem", background: colors.primary[50], borderRadius: "0.75rem", display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem" }}>
        <Shimmer width="120px" height="12px" />
        <Shimmer width="60%" height="40px" />
        <Shimmer width="100px" height="14px" />
        <Shimmer width="40%" height="60px" />
        <Shimmer width="250px" height="14px" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "1.5rem" }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ borderLeft: `3px solid ${colors.primary[100]}`, paddingLeft: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <Shimmer width="60px" height="10px" />
            <Shimmer width="100px" height="16px" />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", borderTop: `1px solid ${colors.primary[100]}`, paddingTop: "1.5rem" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <Shimmer width="150px" height="10px" />
          <Shimmer width="100%" height="12px" />
          <Shimmer width="180px" height="12px" />
        </div>
        <div style={{ marginLeft: "2rem" }}>
          <Shimmer width="80px" height="80px" borderRadius="0.5rem" />
        </div>
      </div>
    </div>
  );
}

// Mirrors OrderBookChart's initial-load state: the step chart on the left,
// the "estimated fill" and depth-metric panels stacked on the right. Reuses
// the same two-column ratio (1.2fr / 0.8fr) and stacks to one column below
// 768px, matching the real .sdex-widget-grid breakpoint.
function MetricRowSkeleton() {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", padding: "0.25rem 0" }}>
      <Shimmer width="70px" height="12px" />
      <Shimmer width="60px" height="14px" />
    </div>
  );
}

// Renders just the chart + metrics grid (no outer card/header) so callers like
// OrderBookChart can drop it in place of their data-dependent content while
// keeping their own static header visible during the initial load.
function PricingTableSkeleton() {
  return (
    <div className="skeleton-pricing-grid">
      <Shimmer width="100%" height="360px" borderRadius="0.75rem" />

      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div style={{ background: colors.neutral[50], border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.5rem", padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <Shimmer width="100%" height="42px" borderRadius="0.375rem" />
          <Shimmer width="90%" height="12px" />
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <Shimmer width="140px" height="34px" borderRadius="0.375rem" />
            <Shimmer width="110px" height="34px" borderRadius="0.375rem" />
          </div>
        </div>

        <div style={{ background: colors.neutral[50], border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.5rem", padding: "1rem" }}>
          {Array.from({ length: 5 }).map((_, i) => <MetricRowSkeleton key={i} />)}
        </div>
      </div>

      <style>{`
        .skeleton-pricing-grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          gap: 1.25rem;
        }
        @media (max-width: 767px) {
          .skeleton-pricing-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
}

// Generic table row — used wherever a real <table>/list is still loading.
// Renders as its own bordered rows (not literal <tr>s) so a caller can drop
// it in place of the whole table while data is in flight, same pattern as
// MarketplaceItemSkeleton.
function TableRowSkeleton({ columns = 4 }: { columns?: number }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${columns}, 1fr)`,
      alignItems: "center",
      gap: "1rem",
      padding: "0.85rem 1rem",
      borderBottom: `1px solid ${colors.neutral[100]}`,
    }}>
      {Array.from({ length: columns }).map((_, i) => (
        <Shimmer key={i} width={i === 0 ? "80%" : "55%"} height="14px" />
      ))}
    </div>
  );
}

export default function LoadingSkeleton({ variant = "CreditCard", count = 1, className, columns }: Props) {
  const skeletons = Array.from({ length: count });

  return (
    <div className={className} aria-busy="true">
      <style>{`
        @keyframes shimmer {
          0%   { background-position: -200% 0; }
          100% { background-position:  200% 0; }
        }
      `}</style>
      {skeletons.map((_, i) => {
        if (variant === "CreditCard")      return <CreditCardSkeleton key={i} />;
        if (variant === "MarketplaceItem") return <MarketplaceItemSkeleton key={i} />;
        if (variant === "PoolStats")       return <PoolStatsSkeleton key={i} />;
        if (variant === "ProjectCard")     return <ProjectCardSkeleton key={i} />;
        if (variant === "ProvenanceTrail") return <ProvenanceTrailSkeleton key={i} />;
        if (variant === "Certificate")     return <CertificateSkeleton key={i} />;
        if (variant === "AuditItem")       return <AuditItemSkeleton key={i} />;
        if (variant === "PricingTable")    return <PricingTableSkeleton key={i} />;
        if (variant === "Table")           return <TableRowSkeleton key={i} columns={columns} />;
        return <CreditCardSkeleton key={i} />;
      })}
    </div>
  );
}
