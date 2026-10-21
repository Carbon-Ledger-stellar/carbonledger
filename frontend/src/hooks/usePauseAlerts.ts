import { useCallback, useEffect, useMemo, useState } from 'react';

export type PauseAlertType = 'pause' | 'unpause' | 'error';

export interface PauseAlert {
  id: string;
  type: PauseAlertType;
  title: string;
  message: string;
  details?: string;
  timestamp: number;
  read: boolean;
}

export interface PauseAlertInput {
  id?: string;
  type: PauseAlertType;
  title: string;
  message: string;
  details?: string;
  timestamp?: number;
}

const STORAGE_KEY = 'pause-alerts';
const MAX_ALERTS = 50;

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadAlerts(): PauseAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (alert): alert is PauseAlert =>
        alert && typeof alert.id === 'string' && typeof alert.type === 'string',
    );
  } catch {
    return [];
  }
}

function persistAlerts(alerts: PauseAlert[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts));
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

/**
 * Manages pause-related alerts (pause/unpause events and pause-triggered
 * errors) for the notification center. Exposes the alert list, unread count,
 * and actions to add, mark read/unread, and clear alerts.
 */
export function usePauseAlerts() {
  const [alerts, setAlerts] = useState<PauseAlert[]>(() => loadAlerts());

  useEffect(() => {
    persistAlerts(alerts);
  }, [alerts]);

  const addAlert = useCallback((input: PauseAlertInput) => {
    const alert: PauseAlert = {
      id: input.id ?? createId(),
      type: input.type,
      title: input.title,
      message: input.message,
      details: input.details,
      timestamp: input.timestamp ?? Date.now(),
      read: false,
    };
    setAlerts((prev) => [alert, ...prev].slice(0, MAX_ALERTS));
    return alert;
  }, []);

  const markAsRead = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((alert) => (alert.id === id ? { ...alert, read: true } : alert)),
    );
  }, []);

  const markAsUnread = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((alert) => (alert.id === id ? { ...alert, read: false } : alert)),
    );
  }, []);

  const toggleRead = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((alert) =>
        alert.id === id ? { ...alert, read: !alert.read } : alert,
      ),
    );
  }, []);

  const markAllAsRead = useCallback(() => {
    setAlerts((prev) => prev.map((alert) => ({ ...alert, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setAlerts([]);
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  }, []);

  const unreadCount = useMemo(
    () => alerts.reduce((count, alert) => (alert.read ? count : count + 1), 0),
    [alerts],
  );

  return {
    alerts,
    unreadCount,
    addAlert,
    markAsRead,
    markAsUnread,
    toggleRead,
    markAllAsRead,
    removeAlert,
    clearAll,
  };
}

export default usePauseAlerts;
