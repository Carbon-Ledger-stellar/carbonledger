import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type PauseAlertKind = 'pause' | 'unpause' | 'error';

export interface PauseAlert {
  id: string;
  kind: PauseAlertKind;
  title: string;
  message: string;
  timestamp: number;
  details?: string;
}

interface PauseAlertsBellProps {
  alerts?: PauseAlert[];
  onClearAll?: () => void;
}

const KIND_LABEL: Record<PauseAlertKind, string> = {
  pause: 'Paused',
  unpause: 'Unpaused',
  error: 'Error',
};

const KIND_ICON: Record<PauseAlertKind, string> = {
  pause: '\u23F8',
  unpause: '\u25B6',
  error: '\u26A0',
};

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PauseAlertsBell({ alerts = [], onClearAll }: PauseAlertsBellProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const sortedAlerts = useMemo(
    () => [...alerts].sort((a, b) => b.timestamp - a.timestamp),
    [alerts],
  );

  const unreadCount = useMemo(
    () => sortedAlerts.filter((alert) => !readIds.has(alert.id)).length,
    [sortedAlerts, readIds],
  );

  const selectedAlert = useMemo(
    () => sortedAlerts.find((alert) => alert.id === selectedId) ?? null,
    [sortedAlerts, selectedId],
  );

  const toggleRead = useCallback((id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    setReadIds(new Set());
    setSelectedId(null);
    onClearAll?.();
  }, [onClearAll]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="pause-alerts-bell" ref={containerRef}>
      <button
        type="button"
        className="pause-alerts-bell__trigger"
        aria-label={`Pause alerts, ${unreadCount} unread`}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span aria-hidden="true">\u{1F514}</span>
        {unreadCount > 0 && (
          <span className="pause-alerts-bell__count" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="pause-alerts-bell__panel" role="dialog" aria-label="Pause alerts">
          <div className="pause-alerts-bell__header">
            <span>Pause alerts</span>
            <button
              type="button"
              className="pause-alerts-bell__clear"
              onClick={handleClearAll}
              disabled={sortedAlerts.length === 0}
            >
              Clear all
            </button>
          </div>

          {sortedAlerts.length === 0 ? (
            <p className="pause-alerts-bell__empty">No pause alerts yet.</p>
          ) : (
            <ul className="pause-alerts-bell__list">
              {sortedAlerts.map((alert) => {
                const isUnread = !readIds.has(alert.id);
                return (
                  <li
                    key={alert.id}
                    className={`pause-alerts-bell__item pause-alerts-bell__item--${alert.kind}${
                      isUnread ? ' pause-alerts-bell__item--unread' : ''
                    }`}
                  >
                    <button
                      type="button"
                      className="pause-alerts-bell__item-main"
                      onClick={() => setSelectedId(alert.id)}
                    >
                      <span className="pause-alerts-bell__item-icon" aria-hidden="true">
                        {KIND_ICON[alert.kind]}
                      </span>
                      <span className="pause-alerts-bell__item-body">
                        <span className="pause-alerts-bell__item-title">
                          {KIND_LABEL[alert.kind]}: {alert.title}
                        </span>
                        <span className="pause-alerts-bell__item-message">{alert.message}</span>
                        <span className="pause-alerts-bell__item-time">
                          {formatTimestamp(alert.timestamp)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="pause-alerts-bell__item-toggle"
                      aria-label={isUnread ? 'Mark as read' : 'Mark as unread'}
                      onClick={() => toggleRead(alert.id)}
                    >
                      {isUnread ? 'Mark read' : 'Mark unread'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {selectedAlert && (
        <div
          className="pause-alerts-bell__details"
          role="dialog"
          aria-label="Pause alert details"
        >
          <div className="pause-alerts-bell__details-header">
            <span>
              {KIND_LABEL[selectedAlert.kind]}: {selectedAlert.title}
            </span>
            <button
              type="button"
              className="pause-alerts-bell__details-close"
              aria-label="Close details"
              onClick={() => setSelectedId(null)}
            >
              \u00D7
            </button>
          </div>
          <p className="pause-alerts-bell__details-message">{selectedAlert.message}</p>
          {selectedAlert.details && (
            <pre className="pause-alerts-bell__details-extra">{selectedAlert.details}</pre>
          )}
          <span className="pause-alerts-bell__details-time">
            {formatTimestamp(selectedAlert.timestamp)}
          </span>
          <button
            type="button"
            className="pause-alerts-bell__details-toggle"
            onClick={() => toggleRead(selectedAlert.id)}
          >
            {readIds.has(selectedAlert.id) ? 'Mark as unread' : 'Mark as read'}
          </button>
        </div>
      )}
    </div>
  );
}
