"use client";

import { useState } from "react";
import { useLeaderboard } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { colors } from "../../styles/design-system";

const CURRENT_YEAR = new Date().getFullYear();

const MEDAL: Record<number, string> = { 1: "🥇", 2: "🥈", 3: "🥉" };

export default function LeaderboardPage() {
  const [year, setYear] = useState<number | undefined>(undefined);
  const { data, isLoading } = useLeaderboard(year);

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div style={{
          display: "inline-block",
          background: colors.primary[50], color: colors.primary[700],
          border: `1px solid ${colors.primary[200]}`,
          borderRadius: "9999px", padding: "0.3rem 1rem",
          fontSize: "0.8rem", fontWeight: 600, marginBottom: "1rem",
        }}>
          No wallet required · Fully public
        </div>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, color: colors.neutral[900], margin: "0 0 0.5rem" }}>
          Corporate Retirement Leaderboard
        </h1>
        <p style={{ color: colors.neutral[500], margin: 0 }}>
          Top corporations ranked by verified carbon tonnes retired on-chain.
        </p>
      </div>

      {/* Year toggle */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
        {[undefined, CURRENT_YEAR].map((y) => (
          <button
            key={y ?? "all"}
            onClick={() => setYear(y)}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "9999px",
              border: `1px solid ${year === y ? colors.primary[600] : colors.neutral[200]}`,
              background: year === y ? colors.primary[600] : colors.surface,
              color: year === y ? "#fff" : colors.neutral[700],
              fontWeight: 600, fontSize: "0.85rem", cursor: "pointer",
            }}
          >
            {y === undefined ? "All Time" : `${y}`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: "0.75rem",
        overflow: "hidden",
      }}>
        {/* Table header */}
        <div style={{
          display: "grid", gridTemplateColumns: "3rem 1fr auto",
          padding: "0.75rem 1.25rem",
          background: colors.neutral[50],
          borderBottom: `1px solid ${colors.neutral[200]}`,
          fontSize: "0.75rem", fontWeight: 700, color: colors.neutral[500],
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          <span>Rank</span>
          <span>Corporation</span>
          <span>Tonnes Retired</span>
        </div>

        {isLoading && (
          <div style={{ padding: "3rem", textAlign: "center", color: colors.neutral[400] }}>
            Loading…
          </div>
        )}

        {!isLoading && (!data || data.length === 0) && (
          <div style={{ padding: "3rem", textAlign: "center", color: colors.neutral[400] }}>
            No retirements recorded{year ? ` for ${year}` : ""} yet.
          </div>
        )}

        {(data ?? []).map((entry, i) => (
          <div
            key={entry.beneficiary}
            style={{
              display: "grid", gridTemplateColumns: "3rem 1fr auto",
              alignItems: "center",
              padding: "1rem 1.25rem",
              borderBottom: i < (data!.length - 1) ? `1px solid ${colors.neutral[100]}` : "none",
              background: i === 0 ? colors.primary[50] : colors.surface,
            }}
          >
            <span style={{ fontSize: "1.1rem" }}>
              {MEDAL[entry.rank] ?? (
                <span style={{ fontWeight: 700, color: colors.neutral[400], fontSize: "0.9rem" }}>
                  #{entry.rank}
                </span>
              )}
            </span>
            <span style={{ fontWeight: 600, color: colors.neutral[800], fontSize: "0.95rem" }}>
              {entry.beneficiary}
            </span>
            <span style={{
              fontWeight: 700, color: colors.primary[700],
              fontSize: "0.95rem", fontVariantNumeric: "tabular-nums",
            }}>
              {formatTonnes(entry.totalTonnes)}
            </span>
          </div>
        ))}
      </div>

      <p style={{ marginTop: "1rem", fontSize: "0.75rem", color: colors.neutral[400], textAlign: "center" }}>
        Updates every 30 seconds · Data sourced from on-chain retirement events
      </p>
    </div>
  );
}
