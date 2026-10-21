import React from 'react';

export type PauseStatus = 'active' | 'paused' | 'resuming' | 'idle';

export interface PauseStatusIndicatorProps {
  /** Current pause state to display. */
  status: PauseStatus;
  /** Optional label override; defaults to a human-readable status label. */
  label?: string;
  /** Show the text label next to the indicator dot. */
  showLabel?: boolean;
  /** Size variant of the indicator. */
  size?: 'sm' | 'md' | 'lg';
  /** Additional class names. */
  className?: string;
}

const STATUS_LABELS: Record<PauseStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  resuming: 'Resuming',
  idle: 'Idle',
};

const STATUS_COLORS: Record<PauseStatus, string> = {
  active: '#22c55e',
  paused: '#f59e0b',
  resuming: '#3b82f6',
  idle: '#9ca3af',
};

const SIZE_MAP: Record<NonNullable<PauseStatusIndicatorProps['size']>, number> = {
  sm: 8,
  md: 12,
  lg: 16,
};

/**
 * PauseStatusIndicator
 *
 * Reusable indicator that visualizes the current pause state with a colored
 * dot and optional text label. Part of the pause UI component library.
 */
export const PauseStatusIndicator: React.FC<PauseStatusIndicatorProps> = ({
  status,
  label,
  showLabel = true,
  size = 'md',
  className,
}) => {
  const dotSize = SIZE_MAP[size];
  const color = STATUS_COLORS[status];
  const text = label ?? STATUS_LABELS[status];

  return (
    <span
      className={className}
      role="status"
      aria-live="polite"
      aria-label={text}
      data-status={status}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontSize: size === 'sm' ? 12 : size === 'lg' ? 16 : 14,
        lineHeight: 1,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
          flexShrink: 0,
        }}
      />
      {showLabel && <span>{text}</span>}
    </span>
  );
};

export default PauseStatusIndicator;
