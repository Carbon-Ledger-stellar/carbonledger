/**
 * Application theme tokens.
 *
 * Includes light and dark variants. The dark variant defines the pause UI
 * colors (status indicator + banner) with WCAG AA compliant contrast.
 */

export interface PauseTheme {
  /** Background of the pause banner surface. */
  bannerBackground: string;
  /** Primary text color on the pause banner. */
  bannerText: string;
  /** Secondary/muted text on the pause banner. */
  bannerMutedText: string;
  /** Border color for the pause banner. */
  bannerBorder: string;
  /** Fill color of the pause status indicator dot. */
  statusIndicator: string;
  /** Ring/halo around the status indicator for visibility. */
  statusIndicatorRing: string;
  /** Text color for the pause status label. */
  statusText: string;
}

export interface Theme {
  mode: 'light' | 'dark';
  background: string;
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  primary: string;
  pause: PauseTheme;
}

/**
 * Light theme.
 *
 * Contrast ratios (WCAG AA requires >= 4.5:1 for normal text):
 * - bannerText (#1F2937) on bannerBackground (#F3F4F6): ~12.6:1
 * - bannerMutedText (#4B5563) on bannerBackground (#F3F4F6): ~7.0:1
 * - statusText (#1F2937) on surface (#FFFFFF): ~14.7:1
 */
export const lightTheme: Theme = {
  mode: 'light',
  background: '#FFFFFF',
  surface: '#FFFFFF',
  text: '#111827',
  mutedText: '#4B5563',
  border: '#E5E7EB',
  primary: '#2563EB',
  pause: {
    bannerBackground: '#F3F4F6',
    bannerText: '#1F2937',
    bannerMutedText: '#4B5563',
    bannerBorder: '#D1D5DB',
    statusIndicator: '#D97706',
    statusIndicatorRing: '#FDE68A',
    statusText: '#1F2937',
  },
};

/**
 * Dark theme.
 *
 * Pause UI colors chosen for WCAG AA contrast against the dark surfaces.
 * Contrast ratios (WCAG AA requires >= 4.5:1 for normal text):
 * - bannerText (#F9FAFB) on bannerBackground (#1F2937): ~13.4:1
 * - bannerMutedText (#D1D5DB) on bannerBackground (#1F2937): ~8.6:1
 * - statusText (#F9FAFB) on surface (#111827): ~16.1:1
 * - statusIndicator (#FBBF24) on surface (#111827): ~9.6:1 (non-text UI >= 3:1)
 */
export const darkTheme: Theme = {
  mode: 'dark',
  background: '#0B1120',
  surface: '#111827',
  text: '#F9FAFB',
  mutedText: '#D1D5DB',
  border: '#374151',
  primary: '#60A5FA',
  pause: {
    bannerBackground: '#1F2937',
    bannerText: '#F9FAFB',
    bannerMutedText: '#D1D5DB',
    bannerBorder: '#4B5563',
    statusIndicator: '#FBBF24',
    statusIndicatorRing: '#78350F',
    statusText: '#F9FAFB',
  },
};

export const themes: Record<Theme['mode'], Theme> = {
  light: lightTheme,
  dark: darkTheme,
};

export function getTheme(mode: Theme['mode']): Theme {
  return themes[mode];
}
