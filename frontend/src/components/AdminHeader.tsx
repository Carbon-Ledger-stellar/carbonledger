import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePauseStatus } from '../hooks/usePauseStatus';

interface AdminHeaderProps {
  title?: string;
}

const AdminHeader: React.FC<AdminHeaderProps> = ({ title = 'Admin' }) => {
  const { isPaused, pausedAt, pausedBy, reason, loading } = usePauseStatus();
  const [showTooltip, setShowTooltip] = useState(false);

  const statusColor = isPaused ? '#e53e3e' : '#38a169';
  const statusLabel = isPaused ? 'Paused' : 'Active';

  const tooltipDetails = isPaused
    ? `Paused${pausedBy ? ` by ${pausedBy}` : ''}${pausedAt ? ` at ${new Date(pausedAt).toLocaleString()}` : ''}${reason ? ` — ${reason}` : ''}`
    : 'System is active and processing normally';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        height: 64,
        borderBottom: '1px solid #e2e8f0',
        background: '#fff',
      }}
    >
      <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h1>

      <div style={{ position: 'relative' }}>
        <Link
          to="/admin/pause-controls"
          aria-label={`Pause status: ${statusLabel}. Click to manage pause controls.`}
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
          onFocus={() => setShowTooltip(true)}
          onBlur={() => setShowTooltip(false)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            textDecoration: 'none',
            color: '#1a202c',
            padding: '6px 12px',
            borderRadius: 9999,
            border: `1px solid ${statusColor}`,
            background: isPaused ? '#fff5f5' : '#f0fff4',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: statusColor,
              display: 'inline-block',
              boxShadow: isPaused ? `0 0 0 3px rgba(229,62,62,0.2)` : `0 0 0 3px rgba(56,161,105,0.2)`,
            }}
          />
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {loading ? 'Checking…' : statusLabel}
          </span>
        </Link>

        {showTooltip && !loading && (
          <div
            role="tooltip"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              background: '#1a202c',
              color: '#fff',
              padding: '8px 12px',
              borderRadius: 6,
              fontSize: 12,
              whiteSpace: 'nowrap',
              zIndex: 1000,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            }}
          >
            {tooltipDetails}
          </div>
        )}
      </div>
    </header>
  );
};

export default AdminHeader;
