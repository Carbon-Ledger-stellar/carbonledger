import React, { useState } from 'react';
import { useContractPaused } from '../hooks/useContractPaused';

interface LayoutProps {
  children: React.ReactNode;
}

const STATUS_PAGE_URL = 'https://status.example.com';

const PauseBanner: React.FC = () => {
  const { isPaused, reason } = useContractPaused();
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
      <span>
        <strong>Contract paused.</strong>{' '}
        Operations are currently blocked.
        {reason ? ` Reason: ${reason}` : ''}
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <a
          href={STATUS_PAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#ffffff', textDecoration: 'underline', whiteSpace: 'nowrap' }}
        >
          Learn More
        </a>
        <button
          type="button"
          aria-label="Dismiss pause banner"
          onClick={() => setDismissed(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: '16px',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </span>
    </div>
  );
};

const Layout: React.FC<LayoutProps> = ({ children }) => {
  return (
    <div>
      <PauseBanner />
      {children}
    </div>
  );
};

export default Layout;
