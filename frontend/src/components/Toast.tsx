import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  toasts: Toast[];
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: (id: string) => void;
}

const MAX_VISIBLE_TOASTS = 3;
const TOAST_DURATION_MS = 5000;

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

let toastCounter = 0;

const buildToastKey = (message: string, type: ToastType) => `${type}:${message}`;

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const key = buildToastKey(message, type);

      setToasts((current) => {
        // De-duplicate identical toasts: if one with the same message/type
        // already exists, do not add another entry.
        if (current.some((toast) => buildToastKey(toast.message, toast.type) === key)) {
          return current;
        }

        const id = `toast-${++toastCounter}`;
        const next = [...current, { id, message, type }];

        // Cap the number of visible toasts, dropping the oldest first.
        const capped = next.length > MAX_VISIBLE_TOASTS ? next.slice(next.length - MAX_VISIBLE_TOASTS) : next;

        const removed = next.filter((toast) => !capped.includes(toast));
        removed.forEach((toast) => {
          const timer = timers.current[toast.id];
          if (timer) {
            clearTimeout(timer);
            delete timers.current[toast.id];
          }
        });

        timers.current[id] = setTimeout(() => {
          dismissToast(id);
        }, TOAST_DURATION_MS);

        return capped;
      });
    },
    [dismissToast],
  );

  const value = useMemo(() => ({ toasts, showToast, dismissToast }), [toasts, showToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-message">{toast.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
