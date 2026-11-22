import type { Meta, StoryObj } from "@storybook/react";
import { typography, spacing, borderRadius, colors } from "../../styles/design-system";

const meta: Meta = {
  title: "Design System/Tokens",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: `
# Design tokens

All tokens are defined as CSS custom properties in \`frontend/styles/theme.css\` and
re-exported as typed JS/TS constants from \`frontend/styles/design-system.ts\`.

Consume them either as CSS variables (e.g. \`var(--font-size-base)\`) or as the JS
constants (e.g. \`typography.fontSize.base\`).  Every token has a CSS fallback so it
still resolves when imported outside of a page that loads \`theme.css\`.
        `,
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

// ── Typography scale ──────────────────────────────────────────────────────────

export const TypeScale: Story = {
  render: () => {
    const steps = Object.entries(typography.fontSize) as [string, string][];
    return (
      <div>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>Font size scale</h2>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875rem" }}>
          <thead>
            <tr>
              <th style={thStyle}>Token</th>
              <th style={thStyle}>CSS variable</th>
              <th style={thStyle}>Value</th>
              <th style={thStyle}>Preview</th>
            </tr>
          </thead>
          <tbody>
            {steps.map(([key, cssVar]) => {
              const pxValue = fontSizePx[key as keyof typeof fontSizePx] ?? "";
              return (
                <tr key={key}>
                  <td style={tdStyle}><code>typography.fontSize.{key}</code></td>
                  <td style={tdStyle}><code>--font-size-{key}</code></td>
                  <td style={tdStyle}>{pxValue}</td>
                  <td style={{ ...tdStyle, padding: "0.5rem 1rem" }}>
                    <span style={{ fontSize: cssVar, lineHeight: 1 }}>Aa</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "2rem 0 1rem" }}>Font weight</h2>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          {(Object.entries(typography.fontWeight) as [string, string][]).map(([key, val]) => (
            <div key={key} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: val as unknown as number }}>Ag</div>
              <code style={{ fontSize: "0.75rem", color: "#6b7280" }}>{key}<br />({fontWeightValues[key as keyof typeof fontWeightValues]})</code>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "2rem 0 1rem" }}>Line height</h2>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          {(Object.entries(typography.lineHeight) as [string, string][]).map(([key, val]) => (
            <div key={key} style={{ maxWidth: "10rem" }}>
              <p style={{ lineHeight: val, border: "1px solid #e5e7eb", padding: "0.5rem", borderRadius: "0.25rem", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                The quick brown fox jumps over the lazy dog.
              </p>
              <code style={{ fontSize: "0.75rem", color: "#6b7280" }}>{key}</code>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

const fontSizePx: Record<string, string> = {
  xs: "12px", sm: "14px", base: "16px", lg: "18px", xl: "20px",
  "2xl": "24px", "3xl": "30px", "4xl": "36px", "5xl": "48px",
};

const fontWeightValues: Record<string, number> = {
  normal: 400, medium: 500, semibold: 600, bold: 700,
};

// ── Spacing scale ─────────────────────────────────────────────────────────────

export const SpacingScale: Story = {
  render: () => {
    const steps = Object.entries(spacing) as [string, string][];
    const pxMap: Record<string, string> = {
      "0": "0", "1": "4px", "2": "8px", "3": "12px", "4": "16px",
      "5": "20px", "6": "24px", "8": "32px", "10": "40px",
      "12": "48px", "16": "64px", "20": "80px", "24": "96px",
    };
    return (
      <div>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>Spacing scale</h2>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.875rem" }}>
          <thead>
            <tr>
              <th style={thStyle}>Token</th>
              <th style={thStyle}>CSS variable</th>
              <th style={thStyle}>Value</th>
              <th style={thStyle}>Swatch</th>
            </tr>
          </thead>
          <tbody>
            {steps.map(([key, _]) => (
              <tr key={key}>
                <td style={tdStyle}><code>spacing[{key}]</code></td>
                <td style={tdStyle}><code>--spacing-{key}</code></td>
                <td style={tdStyle}>{pxMap[key]}</td>
                <td style={tdStyle}>
                  <div style={{ width: `var(--spacing-${key}, ${pxMap[key]})`, height: "1rem", background: "#16a34a", minWidth: "2px", borderRadius: "2px" }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  },
};

// ── Border radius ─────────────────────────────────────────────────────────────

export const BorderRadiusScale: Story = {
  render: () => {
    const steps = Object.entries(borderRadius) as [string, string][];
    return (
      <div>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>Border radius</h2>
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
          {steps.map(([key, val]) => (
            <div key={key} style={{ textAlign: "center" }}>
              <div style={{ width: "4rem", height: "4rem", background: "#16a34a20", border: "2px solid #16a34a", borderRadius: val, marginBottom: "0.5rem" }} />
              <code style={{ fontSize: "0.75rem", color: "#6b7280" }}>{key}<br />{val.replace("var(--radius-", "").replace(")", "").split(",")[1]?.trim() ?? val}</code>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

// ── Color palette ─────────────────────────────────────────────────────────────

export const ColorPalette: Story = {
  render: () => {
    const primarySwatches = Object.entries(colors.primary) as [string, string][];
    const neutralSwatches = Object.entries(colors.neutral) as [string, string][];
    const semanticGroups: [string, { bg: string; text: string; border: string }][] = [
      ["verified",  colors.verified],
      ["pending",   colors.pending],
      ["suspended", colors.suspended],
      ["rejected",  colors.rejected],
      ["completed", colors.completed],
    ];

    return (
      <div>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "1rem" }}>Primary (green)</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {primarySwatches.map(([key, val]) => (
            <div key={key} style={{ textAlign: "center" }}>
              <div style={{ width: "3rem", height: "3rem", background: val, borderRadius: "0.25rem", border: "1px solid #0001" }} />
              <code style={{ fontSize: "0.65rem", color: "#6b7280", display: "block", marginTop: "0.25rem" }}>{key}</code>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "2rem 0 1rem" }}>Neutral (gray)</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {neutralSwatches.map(([key, val]) => (
            <div key={key} style={{ textAlign: "center" }}>
              <div style={{ width: "3rem", height: "3rem", background: val, borderRadius: "0.25rem", border: "1px solid #0001" }} />
              <code style={{ fontSize: "0.65rem", color: "#6b7280", display: "block", marginTop: "0.25rem" }}>{key}</code>
            </div>
          ))}
        </div>

        <h2 style={{ fontSize: "1rem", fontWeight: 700, margin: "2rem 0 1rem" }}>Semantic colors</h2>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          {semanticGroups.map(([name, group]) => (
            <div key={name} style={{ background: group.bg, border: `1px solid ${group.border}`, borderRadius: "0.5rem", padding: "0.75rem 1rem", minWidth: "8rem" }}>
              <span style={{ color: group.text, fontWeight: 600, fontSize: "0.875rem", textTransform: "capitalize" }}>{name}</span>
            </div>
          ))}
        </div>
      </div>
    );
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 1rem",
  borderBottom: "2px solid #e5e7eb",
  fontWeight: 700,
  fontSize: "0.75rem",
  color: "#6b7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const tdStyle: React.CSSProperties = {
  padding: "0.5rem 1rem",
  borderBottom: "1px solid #f3f4f6",
  verticalAlign: "middle",
};
