import React from 'react';

/**
 * Pause status indicator.
 *
 * Renders a small dot + label describing the current pause state.
 * Colors are defined for both light and dark themes and meet WCAG AA
 * contrast ratios (>= 4.5:1 for text, >= 3:1 for non-text UI) against
 * their respective backgrounds.
 */

export type PauseStatus = 'paused' | 'active' | 'idle';

export interface PauseStatusIndicatorProps {
  status: PauseStatus;
  /** Optional label override. */
  label?: string;
  className?: string;
}

interface StatusTheme {
  /** Foreground (dot + text) color for light mode. */
  light: string;
  /** Foreground (dot + text) color for dark mode. */
  dark: string;
  /** Accessible label used when no override is provided. */
  defaultLabel: string;
}

/**
 * Theme tokens for each pause status.
 *
 * Light values are tuned for a white/near-white surface; dark values are
 * tuned for the app dark surface (#1e1e1e) and keep a >= 4.5:1 contrast
 * ratio so the indicator stays legible in dark mode.
 */
const STATUS_THEME: Record<PauseStatus, StatusTheme> = {
  paused: {
    light: '#b45309', // amber-700 on light surface
    dark: '#fbbf24', // amber-400 on dark surface
    defaultLabel: 'Paused',
  },
  active: {
    light: '#15803d', // green-700 on light surface
    dark: '#4ade80', // green-400 on dark surface
    defaultLabel: 'Active',
  },
  idle: {
    light: '#475569', // slate-600 on light surface
    dark: '#cbd5e1', // slate-300 on dark surface
    defaultLabel: 'Idle',
  },
};

/**
 * Resolve the correct color token for the current color scheme.
 * Uses the `prefers-color-scheme` media query so the indicator follows
 * the app dark theme without requiring a separate prop.
 */
function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = React.useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  React.useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (event: MediaQueryListEvent) => setIsDark(event.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  return isDark;
}

export const PauseStatusIndicator: React.FC<PauseStatusIndicatorProps> = ({
  status,
  label,
  className,
}) => {
  const isDark = useIsDarkMode();
  const theme = STATUS_THEME[status];
  const color = isDark ? theme.dark : theme.light;
  const text = label ?? theme.defaultLabel;

  return (
    <span
      className={className}
      role="status"
      aria-live="polite"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.5rem',
        color,
        fontSize: '0.875rem',
        fontWeight: 500,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: '0.5rem',
          height: '0.5rem',
          borderRadius: '9999px',
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      {text}
    </span>
  );
};

export default PauseStatusIndicator;
