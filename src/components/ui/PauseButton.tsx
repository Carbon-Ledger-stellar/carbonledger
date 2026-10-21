import React from 'react';

export type PauseButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type PauseButtonSize = 'sm' | 'md' | 'lg';

export interface PauseButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Visual style of the button. */
  variant?: PauseButtonVariant;
  /** Size of the button. */
  size?: PauseButtonSize;
  /** Whether the button is currently in the paused state. */
  paused?: boolean;
  /** Whether the button is in a loading/busy state. */
  loading?: boolean;
  /** Optional label override. Defaults to "Pause"/"Resume" based on `paused`. */
  label?: string;
  /** Optional icon rendered before the label. */
  icon?: React.ReactNode;
  /** Click handler. */
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

const VARIANT_CLASSES: Record<PauseButtonVariant, string> = {
  primary: 'pause-button--primary',
  secondary: 'pause-button--secondary',
  ghost: 'pause-button--ghost',
  danger: 'pause-button--danger',
};

const SIZE_CLASSES: Record<PauseButtonSize, string> = {
  sm: 'pause-button--sm',
  md: 'pause-button--md',
  lg: 'pause-button--lg',
};

/**
 * PauseButton
 *
 * Reusable button for pausing and resuming activity. Part of the pause UI
 * component library (#1182).
 */
export const PauseButton: React.FC<PauseButtonProps> = ({
  variant = 'primary',
  size = 'md',
  paused = false,
  loading = false,
  label,
  icon,
  onClick,
  disabled,
  className,
  type = 'button',
  ...rest
}) => {
  const resolvedLabel = label ?? (paused ? 'Resume' : 'Pause');
  const isDisabled = disabled || loading;

  const classes = [
    'pause-button',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    paused ? 'pause-button--paused' : 'pause-button--active',
    loading ? 'pause-button--loading' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      {...rest}
      type={type}
      className={classes}
      onClick={onClick}
      disabled={isDisabled}
      aria-pressed={paused}
      aria-busy={loading}
      aria-label={resolvedLabel}
      data-paused={paused}
    >
      {loading ? (
        <span className="pause-button__spinner" aria-hidden="true" />
      ) : (
        icon && (
          <span className="pause-button__icon" aria-hidden="true">
            {icon}
          </span>
        )
      )}
      <span className="pause-button__label">{resolvedLabel}</span>
    </button>
  );
};

export default PauseButton;
