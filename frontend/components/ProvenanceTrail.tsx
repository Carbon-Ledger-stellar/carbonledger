"use client";

import { colors } from "../styles/design-system";

interface ProvenanceEvent {
  type: "registered" | "verified" | "minted" | "listed" | "purchased" | "retired";
  label: string;
  timestamp: string;
  actor?: string;
  txHash?: string;
  detail?: string;
}

interface Props {
  events: ProvenanceEvent[];
}

const eventConfig: Record<ProvenanceEvent["type"], { icon: string; color: string }> = {
  registered: { icon: "📋", color: colors.neutral[500] },
  verified:   { icon: "✅", color: colors.primary[600] },
  minted:     { icon: "🌱", color: colors.primary[700] },
  listed:     { icon: "🏪", color: "#2563eb" },
  purchased:  { icon: "💼", color: "#7c3aed" },
  retired:    { icon: "🔒", color: colors.primary[800] },
};

export default function ProvenanceTrail({ events }: Props) {
  if (events.length === 0) {
    return (
      <div style={{ 
        textAlign: "center", 
        padding: "2rem", 
        color: colors.neutral[400],
        fontSize: "0.875rem"
      }}>
        No provenance events recorded
      </div>
    );
  }

  return (
    <div style={{ position: "relative", paddingLeft: "2rem" }}>
      {/* Vertical line */}
      <div style={{
        position: "absolute", left: "0.6rem", top: 0, bottom: 0,
        width: "2px", background: colors.primary[200],
      }} />

      {events.map((event, i) => {
        const cfg = eventConfig[event.type];
        return (
          <div key={i} style={{ position: "relative", marginBottom: "1.5rem" }}>
            {/* Dot */}
            <div style={{
              position: "absolute", left: "-1.65rem", top: "0.1rem",
              width: "1.25rem", height: "1.25rem",
              background: cfg.color, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.6rem", border: "2px solid white",
              boxShadow: "0 0 0 2px " + cfg.color + "40",
            }}>
              {event.icon}
            </div>

            <div style={{
              background: colors.surface,
              border: `1px solid ${colors.neutral[200]}`,
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: "0.875rem", color: colors.neutral[800] }}>
                  {event.label}
                </span>
                <span style={{ fontSize: "0.75rem", color: colors.neutral[400] }}>
                  {new Date(event.timestamp).toLocaleDateString("en-US", {
                    year: "numeric", month: "short", day: "numeric",
                  })}
                </span>
              </div>
              {event.detail && (
                <p style={{ fontSize: "0.8rem", color: colors.neutral[600], margin: "0.25rem 0 0" }}>
                  {event.detail}
                </p>
              )}
              {event.txHash && (
                <a
                  href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "0.7rem", color: colors.primary[600], fontFamily: "monospace" }}
                >
                  {event.txHash.slice(0, 16)}…
                </a>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
