"use client";

import { useState } from "react";
import { useLeaderboard } from "../../lib/api";
import { formatTonnes } from "../../lib/carbon-utils";
import { colors } from "../../styles/design-system";
import LoadingSkeleton from "../../components/LoadingSkeleton";

const CURRENT_YEAR = new Date().getFullYear();

const MEDAL: Record<number, { emoji: string; bg: string; border: string; text: string }> = {
  1: { emoji: "🥇", bg: "#fefce8", border: "#fbbf24", text: "#78350f" },
  2: { emoji: "🥈", bg: "#f8fafc", border: "#94a3b8", text: "#1e293b" },
  3: { emoji: "🥉", bg: "#fff7ed", border: "#fb923c", text: "#7c2d12" },
};

/** Deterministic pastel background from beneficiary name */
function avatarColor(name: string): string {
  const hue = name
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  return `hsl(${hue}, 60%, 88%)`;
}

function avatarTextColor(name: string): string {
  const hue = name
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 360;
  return `hsl(${hue}, 60%, 30%)`;
}

export default function LeaderboardPage() {
  const [year, setYear] = useState<number | undefined>(undefined);
  const { data, isLoading } = useLeaderboard(year);

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "2.5rem 2rem" }}>
      {/* Header */}
      <div style={{ marginBottom: "2rem" }}>
        <div
          style={{
            display: "inline-block",
            background: colors.primary[50],
            color: colors.primary[700],
            border: `1px solid ${colors.primary[200]}`,
            borderRadius: "9999px",
            padding: "0.3rem 1rem",
            fontSize: "0.8rem",
            fontWeight: 600,
            marginBottom: "1rem",
          }}
        >
          No wallet required · Fully public
        </div>
        <h1
          style={{
            fontSize: "2rem",
            fontWeight: 800,
            color: colors.neutral[900],
            margin: "0 0 0.5rem",
          }}
        >
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
              border: `1px solid ${
                year === y ? colors.primary[600] : colors.neutral[200]
              }`,
              background: year === y ? colors.primary[600] : colors.surface,
              color: year === y ? "#fff" : colors.neutral[700],
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
            }}
          >
            {y === undefined ? "All Time" : `${y}`}
          </button>
        ))}
      </div>

      {/* Podium — top 3 */}
      {!isLoading && data && data.length >= 3 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1.15fr 1fr",
            gap: "0.75rem",
            marginBottom: "1.5rem",
            alignItems: "flex-end",
          }}
        >
          {/* 2nd place */}
          <PodiumCard entry={data[1]} />
          {/* 1st place */}
          <PodiumCard entry={data[0]} featured />
          {/* 3rd place */}
          <PodiumCard entry={data[2]} />
        </div>
      )}

      {/* Full table */}
      <div
        style={{
          background: colors.surface,
          border: `1px solid ${colors.neutral[200]}`,
          borderRadius: "0.75rem",
          overflow: "hidden",
        }}
      >
        {/* Table header */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "3.5rem 2.5rem 1fr auto",
            padding: "0.75rem 1.25rem",
            background: colors.neutral[50],
            borderBottom: `1px solid ${colors.neutral[200]}`,
            fontSize: "0.75rem",
            fontWeight: 700,
            color: colors.neutral[500],
            textTransform: "uppercase" as const,
            letterSpacing: "0.05em",
          }}
        >
          <span>Rank</span>
          <span />
          <span>Corporation</span>
          <span>Tonnes Retired</span>
        </div>

        {isLoading && (
          <LoadingSkeleton variant="Table" columns={3} count={8} />
        )}

        {!isLoading && (!data || data.length === 0) && (
          <div
            style={{
              padding: "3rem",
              textAlign: "center",
              color: colors.neutral[400],
            }}
          >
            No retirements recorded{year ? ` for ${year}` : ""} yet.
          </div>
        )}

        {(data ?? []).map((entry, i) => {
          const medal = MEDAL[entry.rank];
          return (
            <div
              key={entry.beneficiary}
              style={{
                display: "grid",
                gridTemplateColumns: "3.5rem 2.5rem 1fr auto",
                alignItems: "center",
                padding: "0.9rem 1.25rem",
                borderBottom:
                  i < (data!.length - 1)
                    ? `1px solid ${colors.neutral[100]}`
                    : "none",
                background: medal ? medal.bg : colors.surface,
                borderLeft: medal
                  ? `3px solid ${medal.border}`
                  : "3px solid transparent",
              }}
            >
              {/* Rank */}
              <span
                style={{
                  fontSize: medal ? "1.2rem" : "0.9rem",
                  fontWeight: 700,
                  color: medal ? medal.text : colors.neutral[400],
                }}
              >
                {medal ? medal.emoji : `#${entry.rank}`}
              </span>

              {/* Avatar */}
              <div
                aria-hidden="true"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: avatarColor(entry.beneficiary),
                  color: avatarTextColor(entry.beneficiary),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.85rem",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {entry.beneficiary.charAt(0).toUpperCase()}
              </div>

              {/* Name */}
              <span
                style={{
                  fontWeight: 600,
                  color: colors.neutral[800],
                  fontSize: "0.95rem",
                  paddingLeft: "0.75rem",
                }}
              >
                {entry.beneficiary}
              </span>

              {/* Tonnes */}
              <span
                style={{
                  fontWeight: 700,
                  color: colors.primary[700],
                  fontSize: "0.95rem",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatTonnes(entry.totalTonnes)}
              </span>
            </div>
          );
        })}
      </div>

      <p
        style={{
          marginTop: "1rem",
          fontSize: "0.75rem",
          color: colors.neutral[400],
          textAlign: "center",
        }}
      >
        Updates every 30 seconds · Data sourced from on-chain retirement events
      </p>
    </div>
  );
}

// ── Podium card ───────────────────────────────────────────────────────────────

function PodiumCard({
  entry,
  featured,
}: {
  entry: { rank: number; beneficiary: string; totalTonnes: number };
  featured?: boolean;
}) {
  const medal = MEDAL[entry.rank]!;
  return (
    <div
      style={{
        background: medal.bg,
        border: `2px solid ${medal.border}`,
        borderRadius: "0.75rem",
        padding: featured ? "1.25rem 1rem" : "1rem 0.75rem",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "0.5rem",
        boxShadow: featured ? "0 4px 12px rgba(0,0,0,0.08)" : undefined,
      }}
    >
      <span style={{ fontSize: featured ? "2rem" : "1.6rem" }}>
        {medal.emoji}
      </span>
      <div
        style={{
          width: featured ? 48 : 40,
          height: featured ? 48 : 40,
          borderRadius: "50%",
          background: avatarColor(entry.beneficiary),
          color: avatarTextColor(entry.beneficiary),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: featured ? "1.1rem" : "0.95rem",
          fontWeight: 700,
          margin: "0 auto",
        }}
        aria-hidden="true"
      >
        {entry.beneficiary.charAt(0).toUpperCase()}
      </div>
      <p
        style={{
          fontWeight: 700,
          color: medal.text,
          fontSize: featured ? "0.9rem" : "0.8rem",
          margin: 0,
          wordBreak: "break-word",
        }}
      >
        {entry.beneficiary}
      </p>
      <p
        style={{
          fontWeight: 800,
          color: colors.primary[700],
          fontSize: featured ? "1rem" : "0.85rem",
          margin: 0,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {formatTonnes(entry.totalTonnes)}
      </p>
    </div>
  );
}
