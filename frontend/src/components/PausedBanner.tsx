import { useState } from 'react';

interface PausedBannerProps {
  isPaused: boolean;
  pauseReason?: string;
  statusPageUrl?: string;
}

const DEFAULT_STATUS_PAGE_URL = '/status';

export function PausedBanner({
  isPaused,
  pauseReason,
  statusPageUrl = DEFAULT_STATUS_PAGE_URL,
}: PausedBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (!isPaused || dismissed) {
    return null;
  }

  return (
    <div
      role="alert"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        width: '100%',
        backgroundColor: '#c0392b',
        color: '#ffffff',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <strong>Contract paused</strong>
        <span>
          {pauseReason
            ? pauseReason
            : 'Operations are currently blocked while the contract is paused.'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <a
          href={statusPageUrl}
          style={{ color: '#ffffff', textDecoration: 'underline', whiteSpace: 'nowrap' }}
        >
          Learn More
        </a>
        <button
          type="button"
          aria-label="Dismiss paused banner"
          onClick={() => setDismissed(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

export default PausedBanner;
