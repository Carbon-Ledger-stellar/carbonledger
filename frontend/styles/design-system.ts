// Design system tokens for CarbonLedger
// Professional corporate green palette — buyers are sustainability officers and CFOs

export const colors = {
  // Primary greens
  primary: {
    50:  "var(--color-primary-50)",
    100: "var(--color-primary-100)",
    200: "var(--color-primary-200)",
    300: "var(--color-primary-300)",
    400: "var(--color-primary-400)",
    500: "var(--color-primary-500)",
    600: "var(--color-primary-600)",
    700: "var(--color-primary-700)",
    800: "var(--color-primary-800)",
    900: "var(--color-primary-900)",
    950: "var(--color-primary-950)",
  },
  // Neutral grays
  neutral: {
    50:  "var(--color-neutral-50)",
    100: "var(--color-neutral-100)",
    200: "var(--color-neutral-200)",
    300: "var(--color-neutral-300)",
    400: "var(--color-neutral-400)",
    500: "var(--color-neutral-500)",
    600: "var(--color-neutral-600)",
    700: "var(--color-neutral-700)",
    800: "var(--color-neutral-800)",
    900: "var(--color-neutral-900)",
    950: "var(--color-neutral-950)",
  },
  // Semantic
  verified:  { bg: "var(--color-verified-bg)", text: "var(--color-verified-text)", border: "var(--color-verified-border)" },
  pending:   { bg: "var(--color-pending-bg)", text: "var(--color-pending-text)", border: "var(--color-pending-border)" },
  suspended: { bg: "var(--color-suspended-bg)", text: "var(--color-suspended-text)", border: "var(--color-suspended-border)" },
  rejected:  { bg: "var(--color-rejected-bg)", text: "var(--color-rejected-text)", border: "var(--color-rejected-border)" },
  completed: { bg: "var(--color-completed-bg)", text: "var(--color-completed-text)", border: "var(--color-completed-border)" },
  // USDC blue
  usdc: "var(--color-usdc)",
  // White / surface
  surface: "var(--color-surface)",
  surfaceAlt: "var(--color-surface-alt)",
} as const;

// Dark mode variants
export const darkColors = {
  // Primary greens (slightly adjusted for dark backgrounds)
  primary: {
    50:  "#052e16",
    100: "#14532d",
    200: "#166534",
    300: "#15803d",
    400: "#16a34a",
    500: "#22c55e",
    600: "#4ade80",
    700: "#86efac",
    800: "#bbf7d0",
    900: "#dcfce7",
    950: "#f0fdf4",
  },
  // Neutral grays (inverted for dark mode)
  neutral: {
    50:  "#030712",
    100: "#111827",
    200: "#1f2937",
    300: "#374151",
    400: "#4b5563",
    500: "#6b7280",
    600: "#9ca3af",
    700: "#d1d5db",
    800: "#e5e7eb",
    900: "#f3f4f6",
    950: "#f9fafb",
  },
  // Semantic (dark mode variants)
  verified:  { bg: "#14532d", text: "#86efac", border: "#15803d" },
  pending:   { bg: "#451a03", text: "#fde047", border: "#854d0e" },
  suspended: { bg: "#450a0a", text: "#fca5a5", border: "#991b1b" },
  rejected:  { bg: "#500724", text: "#f9a8d4", border: "#9d174d" },
  completed: { bg: "#2e1065", text: "#c4b5fd", border: "#5b21b6" },
  // USDC blue (same)
  usdc: "#2775CA",
  // Dark surfaces
  surface: "#111827",
  surfaceAlt: "#1f2937",
} as const;

export const typography = {
  fontFamily: {
    sans:  "'Inter', 'Helvetica Neue', Arial, sans-serif",
    mono:  "'JetBrains Mono', 'Fira Code', monospace",
  },
  fontSize: {
    xs:   "0.75rem",
    sm:   "0.875rem",
    base: "1rem",
    lg:   "1.125rem",
    xl:   "1.25rem",
    "2xl": "1.5rem",
    "3xl": "1.875rem",
    "4xl": "2.25rem",
    "5xl": "3rem",
  },
  fontWeight: {
    normal:   400,
    medium:   500,
    semibold: 600,
    bold:     700,
  },
} as const;

export const spacing = {
  0:  "0",
  1:  "0.25rem",
  2:  "0.5rem",
  3:  "0.75rem",
  4:  "1rem",
  5:  "1.25rem",
  6:  "1.5rem",
  8:  "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
  20: "5rem",
  24: "6rem",
} as const;

export const borderRadius = {
  sm:   "0.25rem",
  md:   "0.375rem",
  lg:   "0.5rem",
  xl:   "0.75rem",
  "2xl": "1rem",
  full: "9999px",
} as const;

export const shadows = {
  sm:  "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  md:  "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg:  "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  xl:  "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  certificate: "0 25px 50px -12px rgb(0 0 0 / 0.25)",
} as const;

export const statusBadge = (status: string) => {
  const map: Record<string, { bg: string; text: string; border: string }> = {
    Verified:  colors.verified,
    Pending:   colors.pending,
    Suspended: colors.suspended,
    Rejected:  colors.rejected,
    Completed: colors.completed,
    Active:    colors.verified,
    Sold:      colors.completed,
    Delisted:  colors.suspended,
  };
  return map[status] ?? colors.pending;
};
