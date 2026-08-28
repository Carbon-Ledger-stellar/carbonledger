"use client";

import { MapPin } from "../lib/map-utils";
import { formatTonnes } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";

interface Props {
  pins: MapPin[];
}

/**
 * Plain accessible table rendering of the same project pins shown on
 * the map. Used when the map fails to render (via ErrorBoundary's
 * `fallback` prop) and as a manual "table view" the user can switch to
 * — the more reliable option for screen-reader and keyboard-only users
 * browsing many clustered projects.
 */
export default function MapFallbackTable({ pins }: Props) {
  if (pins.length === 0) {
    return (
      <div
        style={{
          padding: "2rem",
          textAlign: "center",
          color: colors.neutral[500],
          fontSize: "0.875rem",
          background: colors.surfaceAlt,
          borderRadius: "0.75rem",
        }}
      >
        No projects match the current filters.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto", border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.75rem" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
        <caption style={{ textAlign: "left", padding: "0.75rem 1rem", fontWeight: 700, color: colors.neutral[900] }}>
          Projects with mapped locations
        </caption>
        <thead>
          <tr style={{ background: colors.surfaceAlt, textAlign: "left" }}>
            <th scope="col" style={{ padding: "0.6rem 1rem" }}>Project</th>
            <th scope="col" style={{ padding: "0.6rem 1rem" }}>Type</th>
            <th scope="col" style={{ padding: "0.6rem 1rem" }}>Country</th>
            <th scope="col" style={{ padding: "0.6rem 1rem" }}>Vintage</th>
            <th scope="col" style={{ padding: "0.6rem 1rem" }}>Methodology score</th>
            <th scope="col" style={{ padding: "0.6rem 1rem" }}>Available</th>
            <th scope="col" style={{ padding: "0.6rem 1rem" }}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {pins.map((pin) => (
            <tr key={pin.listingId} style={{ borderTop: `1px solid ${colors.neutral[200]}` }}>
              <td style={{ padding: "0.6rem 1rem", fontWeight: 600, color: colors.neutral[900] }}>{pin.projectName}</td>
              <td style={{ padding: "0.6rem 1rem", color: colors.neutral[600] }}>{pin.projectType}</td>
              <td style={{ padding: "0.6rem 1rem", color: colors.neutral[600] }}>{pin.country}</td>
              <td style={{ padding: "0.6rem 1rem", color: colors.neutral[600] }}>{pin.vintageYear}</td>
              <td style={{ padding: "0.6rem 1rem", color: colors.neutral[600] }}>{pin.methodologyScore}/100</td>
              <td style={{ padding: "0.6rem 1rem", color: colors.neutral[600] }}>{formatTonnes(pin.amountAvailable)}</td>
              <td style={{ padding: "0.6rem 1rem" }}>
                <a
                  href={`/projects/${pin.projectId}`}
                  style={{
                    color: colors.primary[700],
                    fontWeight: 600,
                    textDecoration: "none",
                    whiteSpace: "nowrap",
                  }}
                >
                  View Details
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
