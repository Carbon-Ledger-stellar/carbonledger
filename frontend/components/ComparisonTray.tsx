"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { MarketListing } from "../lib/api";
import { colors } from "../styles/design-system";
import { formatTonnes } from "../lib/carbon-utils";
import { useLocaleFormatters } from "../lib/i18n/format";

export const MAX_COMPARISON_ITEMS = 4;

interface ComparisonTrayProps {
  selected: MarketListing[];
  onRemove: (listingId: string) => void;
  onClear: () => void;
}

export default function ComparisonTray({ selected, onRemove, onClear }: ComparisonTrayProps) {
  const t = useTranslations("comparisonTray");
  const { formatCurrency } = useLocaleFormatters();
  const [open, setOpen] = useState(false);

  if (selected.length === 0) return null;

  return (
    <>
      <div
        role="region"
        aria-label={t("trayLabel")}
        style={{
          position: "sticky",
          bottom: 0,
          zIndex: 40,
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem 0.75rem 0 0",
          boxShadow: "0 -4px 12px rgba(0,0,0,0.08)",
          padding: "0.75rem 1.25rem",
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          flexWrap: "wrap",
          marginTop: "1.5rem",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.875rem", color: colors.neutral[900] }}>
          {t("selectedCount", { count: selected.length, max: MAX_COMPARISON_ITEMS })}
        </span>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", flex: 1 }}>
          {selected.map((listing) => (
            <span
              key={listing.listingId}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                background: colors.primary[50],
                color: colors.primary[700],
                borderRadius: "9999px",
                padding: "0.25rem 0.4rem 0.25rem 0.75rem",
                fontSize: "0.75rem",
                fontWeight: 600,
              }}
            >
              {listing.projectName || listing.projectId}
              <button
                onClick={() => onRemove(listing.listingId)}
                aria-label={t("removeFromComparison", { project: listing.projectName || listing.projectId })}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: colors.primary[700], fontSize: "0.9rem", lineHeight: 1,
                  padding: "0.15rem",
                }}
              >
                ✕
              </button>
            </span>
          ))}
        </div>

        <button
          onClick={onClear}
          style={{
            background: "none", border: "none", color: colors.neutral[500],
            fontSize: "0.8rem", cursor: "pointer", padding: "0.4rem 0.5rem",
          }}
        >
          {t("clearAll")}
        </button>
        <button
          onClick={() => setOpen(true)}
          disabled={selected.length < 2}
          style={{
            background: selected.length < 2 ? colors.neutral[200] : colors.primary[600],
            color: selected.length < 2 ? colors.neutral[500] : "#fff",
            border: "none", borderRadius: "0.5rem",
            padding: "0.6rem 1.25rem", fontSize: "0.875rem", fontWeight: 700,
            cursor: selected.length < 2 ? "not-allowed" : "pointer",
          }}
        >
          {t("compareButton")}
        </button>
      </div>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("modalLabel")}
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: "1.5rem",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div
            style={{
              background: colors.surface,
              borderRadius: "1rem",
              padding: "1.5rem",
              maxWidth: "1000px",
              width: "100%",
              maxHeight: "85vh",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: colors.neutral[900] }}>
                {t("modalTitle")}
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label={t("closeComparison")}
                style={{ background: "none", border: "none", fontSize: "1.25rem", cursor: "pointer", color: colors.neutral[600] }}
              >
                ✕
              </button>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: `${240 + selected.length * 180}px` }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem", fontSize: "0.75rem", color: colors.neutral[500] }} />
                    {selected.map((l) => (
                      <th key={l.listingId} style={{ textAlign: "left", padding: "0.5rem", fontSize: "0.9rem", fontWeight: 700, color: colors.neutral[900] }}>
                        {l.projectName || l.projectId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: t("rowMethodology"), render: (l: MarketListing) => l.methodology },
                    { label: t("rowVintage"), render: (l: MarketListing) => String(l.vintageYear) },
                    { label: t("rowCountry"), render: (l: MarketListing) => l.country },
                    { label: t("rowPrice"), render: (l: MarketListing) => `$${formatCurrency(l.pricePerCredit)}` },
                    { label: t("rowAvailable"), render: (l: MarketListing) => formatTonnes(l.amountAvailable) },
                  ].map((row) => (
                    <tr key={row.label} style={{ borderTop: `1px solid ${colors.neutral[200]}` }}>
                      <td style={{ padding: "0.6rem 0.5rem", fontSize: "0.8rem", color: colors.neutral[500], fontWeight: 600 }}>
                        {row.label}
                      </td>
                      {selected.map((l) => (
                        <td key={l.listingId} style={{ padding: "0.6rem 0.5rem", fontSize: "0.875rem", color: colors.neutral[800] }}>
                          {row.render(l)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr style={{ borderTop: `1px solid ${colors.neutral[200]}` }}>
                    <td style={{ padding: "0.6rem 0.5rem" }} />
                    {selected.map((l) => (
                      <td key={l.listingId} style={{ padding: "0.6rem 0.5rem" }}>
                        <a
                          href={`/buy?listing=${l.listingId}`}
                          style={{
                            display: "inline-block",
                            padding: "0.5rem 0.875rem", fontSize: "0.8rem", fontWeight: 600,
                            border: `1px solid ${colors.primary[300]}`, borderRadius: "0.375rem",
                            color: colors.primary[700], textDecoration: "none", background: colors.primary[50],
                          }}
                        >
                          {t("buyNow")}
                        </a>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
