import React, { useCallback, useMemo, useState } from 'react';

export type PauseAlertType = 'pause' | 'unpause' | 'error';

export interface PauseAlert {
  id: string;
  type: PauseAlertType;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
  details?: string;
}

interface NotificationCenterProps {
  alerts: PauseAlert[];
  onMarkRead?: (id: string, read: boolean) => void;
  onClearAll?: () => void;
}

const typeStyles: Record<PauseAlertType, { icon: string; color: string; label: string }> = {
  pause: { icon: '\u23F8', color: '#d97706', label: 'Paused' },
  unpause: { icon: '\u25B6', color: '#16a34a', label: 'Resumed' },
  error: { icon: '\u26A0', color: '#dc2626', label: 'Error' },
};

const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

const NotificationCenter: React.FC<NotificationCenterProps> = ({
  alerts,
  onMarkRead,
  onClearAll,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => alerts.filter((alert) => !alert.read).length,
    [alerts],
  );

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) => b.timestamp - a.timestamp),
    [alerts],
  );

  const selectedAlert = useMemo(
    () => sortedAlerts.find((alert) => alert.id === selectedId) ?? null,
    [sortedAlerts, selectedId],
  );

  const handleToggle = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const handleSelect = useCallback(
    (alert: PauseAlert) => {
      setSelectedId(alert.id);
      if (!alert.read && onMarkRead) {
        onMarkRead(alert.id, true);
      }
    },
    [onMarkRead],
  );

  const handleToggleRead = useCallback(
    (event: React.MouseEvent, alert: PauseAlert) => {
      event.stopPropagation();
      if (onMarkRead) {
        onMarkRead(alert.id, !alert.read);
      }
    },
    [onMarkRead],
  );

  const handleClearAll = useCallback(() => {
    setSelectedId(null);
    if (onClearAll) {
      onClearAll();
    }
  }, [onClearAll]);

  return (
    <div className="notification-center" style={{ position: 'relative' }}>
      <button
        type="button"
        className="notification-center__bell"
        aria-label={`Pause alerts, ${unreadCount} unread`}
        aria-expanded={isOpen}
        onClick={handleToggle}
        style={{
          position: 'relative',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: '1.25rem',
          padding: '0.25rem',
        }}
      >
        <span aria-hidden="true">\u{1F514}</span>
        {unreadCount > 0 && (
          <span
            className="notification-center__badge"
            style={{
              position: 'absolute',
              top: '-4px',
              right: '-4px',
              minWidth: '18px',
              height: '18px',
              borderRadius: '9px',
              background: '#dc2626',
              color: '#fff',
              fontSize: '0.7rem',
              lineHeight: '18px',
              textAlign: 'center',
              padding: '0 4px',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="notification-center__panel"
          role="dialog"
          aria-label="Pause alerts"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            width: '360px',
            maxHeight: '420px',
            overflowY: 'auto',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            zIndex: 1000,
          }}
        >
          <div
            className="notification-center__header"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0.75rem 1rem',
              borderBottom: '1px solid #e5e7eb',
            }}
          >
            <strong>Pause Alerts</strong>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={alerts.length === 0}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563eb',
                cursor: alerts.length === 0 ? 'default' : 'pointer',
                fontSize: '0.8rem',
                opacity: alerts.length === 0 ? 0.5 : 1,
              }}
            >
              Clear all
            </button>
          </div>

          {sortedAlerts.length === 0 ? (
            <p
              className="notification-center__empty"
              style={{ padding: '1rem', color: '#6b7280', fontSize: '0.875rem' }}
            >
              No pause alerts.
            </p>
          ) : (
            <ul className="notification-center__list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {sortedAlerts.map((alert) => {
                const style = typeStyles[alert.type];
                return (
                  <li
                    key={alert.id}
                    className="notification-center__item"
                    onClick={() => handleSelect(alert)}
                    style={{
                      display: 'flex',
                      gap: '0.5rem',
                      padding: '0.75rem 1rem',
                      borderBottom: '1px solid #f3f4f6',
                      cursor: 'pointer',
                      background: alert.read ? '#fff' : '#f9fafb',
                    }}
                  >
                    <span aria-hidden="true" style={{ color: style.color }}>
                      {style.icon}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                        <span style={{ fontWeight: alert.read ? 400 : 600, fontSize: '0.875rem' }}>
                          {alert.title}
                        </span>
                        <span style={{ color: '#9ca3af', fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
                          {formatTimestamp(alert.timestamp)}
                        </span>
                      </div>
                      <p style={{ margin: '0.25rem 0 0', color: '#4b5563', fontSize: '0.8rem' }}>
                        {alert.message}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(event) => handleToggleRead(event, alert)}
                      aria-label={alert.read ? 'Mark as unread' : 'Mark as read'}
                      style={{
                        alignSelf: 'flex-start',
                        background: 'none',
                        border: 'none',
                        color: '#2563eb',
                        cursor: 'pointer',
                        fontSize: '0.7rem',
                      }}
                    >
                      {alert.read ? 'Unread' : 'Read'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {selectedAlert && (
            <div
              className="notification-center__details"
              style={{
                padding: '0.75rem 1rem',
                borderTop: '1px solid #e5e7eb',
                background: '#f9fafb',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong style={{ fontSize: '0.85rem' }}>{selectedAlert.title}</strong>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Close details"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}
                >
                  \u00D7
                </button>
              </div>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.8rem', color: '#374151' }}>
                {selectedAlert.details ?? selectedAlert.message}
              </p>
              <p style={{ margin: '0.5rem 0 0', fontSize: '0.7rem', color: '#9ca3af' }}>
                {typeStyles[selectedAlert.type].label} \u00B7 {formatTimestamp(selectedAlert.timestamp)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NotificationCenter;
