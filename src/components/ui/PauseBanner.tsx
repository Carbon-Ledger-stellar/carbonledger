import React from 'react';

export type PauseBannerVariant = 'info' | 'warning' | 'error' | 'success';

export interface PauseBannerProps {
  /** Controls the visual style of the banner. */
  variant?: PauseBannerVariant;
  /** Main heading text. */
  title?: string;
  /** Supporting message shown under the title. */
  message?: React.ReactNode;
  /** Optional icon rendered before the text content. */
  icon?: React.ReactNode;
  /** Optional action element (e.g. a PauseButton) rendered on the right. */
  action?: React.ReactNode;
  /** When true, renders a dismiss button and calls onDismiss when clicked. */
  dismissible?: boolean;
  /** Called when the dismiss button is clicked. */
  onDismiss?: () => void;
  /** Additional class names applied to the root element. */
  className?: string;
  /** Inline styles applied to the root element. */
  style?: React.CSSProperties;
  /** Banner contents; used when title/message are not provided. */
  children?: React.ReactNode;
}

const variantStyles: Record<PauseBannerVariant, React.CSSProperties> = {
  info: { background: '#e8f1fb', borderColor: '#2f6fbf', color: '#1b3f6b' },
  warning: { background: '#fdf3e2', borderColor: '#c98a1b', color: '#6b4a0b' },
  error: { background: '#fbe9e9', borderColor: '#c0392b', color: '#6b1b14' },
  success: { background: '#e9f7ee', borderColor: '#2e8b57', color: '#1b5b38' },
};

/**
 * PauseBanner
 *
 * Reusable banner for surfacing pause-related status and messages.
 */
export const PauseBanner: React.FC<PauseBannerProps> = ({
  variant = 'info',
  title,
  message,
  icon,
  action,
  dismissible = false,
  onDismiss,
  className,
  style,
  children,
}) => {
  const variantStyle = variantStyles[variant];

  return (
    <div
      role="status"
      className={['pause-banner', `pause-banner--${variant}`, className]
        .filter(Boolean)
        .join(' ')}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        padding: '12px 16px',
        border: '1px solid',
        borderRadius: 8,
        ...variantStyle,
        ...style,
      }}
    >
      {icon ? (
        <span className="pause-banner__icon" aria-hidden="true" style={{ flexShrink: 0 }}>
          {icon}
        </span>
      ) : null}

      <div className="pause-banner__content" style={{ flex: 1, minWidth: 0 }}>
        {title ? (
          <div className="pause-banner__title" style={{ fontWeight: 600, marginBottom: message || children ? 4 : 0 }}>
            {title}
          </div>
        ) : null}
        {message ? <div className="pause-banner__message">{message}</div> : null}
        {children}
      </div>

      {action ? (
        <div className="pause-banner__action" style={{ flexShrink: 0 }}>
          {action}
        </div>
      ) : null}

      {dismissible ? (
        <button
          type="button"
          className="pause-banner__dismiss"
          aria-label="Dismiss"
          onClick={onDismiss}
          style={{
            flexShrink: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            color: 'inherit',
            padding: 0,
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
};

export default PauseBanner;
