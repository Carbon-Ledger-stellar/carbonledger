"use client";

import { useOracleHealth, OracleHealth } from "../lib/admin-api";
import { colors, typography, spacing, borderRadius, shadows } from "../styles/design-system";

// Spec thresholds
const AMBER_DAYS = 300;
const RED_DAYS   = 365;

type Status = "green" | "amber" | "red";

function getStatus(o: OracleHealth): Status {
  if (o.daysSinceUpdate >= RED_DAYS)   return "red";
  if (o.daysSinceUpdate >= AMBER_DAYS) return "amber";
  return "green";
}

const STATUS_STYLE: Record<Status, { bg: string; text: string; border: string; dot: string; label: string }> = {
  green: { ...colors.verified,  dot: "#16a34a", label: "Current"  },
  amber: { ...colors.pending,   dot: "#d97706", label: "Warning"  },
  red:   { ...colors.suspended, dot: "#dc2626", label: "Stale"    },
};

function Dot({ status }: { status: Status }) {
  return (
    <span style={{
      display:      "inline-block",
      width:        "8px",
      height:       "8px",
      borderRadius: borderRadius.full,
      background:   STATUS_STYLE[status].dot,
      flexShrink:   0,
    }} />
  );
}

export default function OracleStatus() {
  const { data: oracles, isLoading, error } = useOracleHealth();

  const counts = oracles
    ? { green: 0, amber: 0, red: 0, ...Object.fromEntries(
        (["green", "amber", "red"] as Status[]).map(s => [
          s, oracles.filter(o => getStatus(o) === s).length,
        ])
      ) }
    : null;

  return (
    <section style={{
      background:   colors.surface,
      border:       `1px solid ${colors.neutral[200]}`,
      borderRadius: borderRadius.xl,
      boxShadow:    shadows.sm,
      overflow:     "hidden",
    }}>
      {/* Header */}
      <div style={{
        display:        "flex",
        alignItems:     "center",
        justifyContent: "space-between",
        padding:        `${spacing[4]} ${spacing[5]}`,
        borderBottom:   `1px solid ${colors.neutral[100]}`,
        background:     colors.neutral[50],
      }}>
        <h2 style={{
          fontFamily: typography.fontFamily.sans,
          fontSize:   typography.fontSize.base,
          fontWeight: typography.fontWeight.semibold,
          color:      colors.neutral[900],
          margin:     0,
        }}>
          Oracle Health
        </h2>
        {counts && (
          <div style={{ display: "flex", gap: spacing[2] }}>
            {(["green", "amber", "red"] as Status[]).map(s => counts[s] > 0 && (
              <span key={s} style={{
                display:      "inline-flex",
                alignItems:   "center",
                gap:          spacing[1],
                fontFamily:   typography.fontFamily.sans,
                fontSize:     typography.fontSize.xs,
                fontWeight:   typography.fontWeight.medium,
                color:        STATUS_STYLE[s].text,
                background:   STATUS_STYLE[s].bg,
                border:       `1px solid ${STATUS_STYLE[s].border}`,
                padding:      `2px ${spacing[2]}`,
                borderRadius: borderRadius.full,
              }}>
                <Dot status={s} />
                {counts[s]}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Body */}
      {isLoading && (
        <div style={{ padding: spacing[5] }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{
              height:       "20px",
              background:   colors.neutral[100],
              borderRadius: borderRadius.sm,
              marginBottom: spacing[3],
              animation:    "cl-pulse 1.5s ease-in-out infinite",
            }} />
          ))}
        </div>
      )}

      {error && (
        <p style={{ padding: spacing[5], color: colors.suspended.text, fontFamily: typography.fontFamily.sans, fontSize: typography.fontSize.sm, margin: 0 }}>
          Failed to load oracle health data.
        </p>
      )}

      {!isLoading && !error && oracles && oracles.length === 0 && (
        <p style={{ padding: spacing[5], color: colors.neutral[500], fontFamily: typography.fontFamily.sans, fontSize: typography.fontSize.sm, margin: 0 }}>
          No projects monitored yet.
        </p>
      )}

      {!isLoading && !error && oracles && oracles.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {oracles.map((o, i) => {
            const status = getStatus(o);
            const st     = STATUS_STYLE[status];
            return (
              <li
                key={o.projectId}
                style={{
                  display:      "flex",
                  alignItems:   "center",
                  gap:          spacing[3],
                  padding:      `${spacing[3]} ${spacing[5]}`,
                  borderBottom: i < oracles.length - 1 ? `1px solid ${colors.neutral[100]}` : "none",
                }}
              >
                <Dot status={status} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{
                    fontFamily:   typography.fontFamily.sans,
                    fontSize:     typography.fontSize.sm,
                    fontWeight:   typography.fontWeight.medium,
                    color:        colors.neutral[900],
                    margin:       0,
                    overflow:     "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace:   "nowrap",
                  }}>
                    {o.projectName}
                  </p>
                  <p style={{
                    fontFamily: typography.fontFamily.sans,
                    fontSize:   typography.fontSize.xs,
                    color:      colors.neutral[500],
                    margin:     0,
                  }}>
                    {o.daysSinceUpdate}d ago · {new Date(o.lastMonitored).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </p>
                </div>

                <span style={{
                  fontFamily:   typography.fontFamily.sans,
                  fontSize:     typography.fontSize.xs,
                  fontWeight:   typography.fontWeight.medium,
                  color:        st.text,
                  background:   st.bg,
                  border:       `1px solid ${st.border}`,
                  padding:      `2px ${spacing[2]}`,
                  borderRadius: borderRadius.full,
                  whiteSpace:   "nowrap",
                }}>
                  {st.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Footer: last-refreshed hint */}
      <p style={{
        fontFamily: typography.fontFamily.sans,
        fontSize:   typography.fontSize.xs,
        color:      colors.neutral[400],
        margin:     0,
        padding:    `${spacing[2]} ${spacing[5]}`,
        borderTop:  `1px solid ${colors.neutral[100]}`,
        background: colors.neutral[50],
      }}>
        Auto-refreshes every 60 s
      </p>
    </section>
  );
}
