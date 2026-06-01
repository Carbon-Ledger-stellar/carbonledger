"use client";

import { useEffect, useState } from "react";
import { colors } from "../styles/design-system";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastMessage {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  txHash?: string;
}

interface Props {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const toastConfig: Record<ToastType, { bg: string; border: string; icon: string; titleColor: string; live: "assertive" | "polite" }> = {
  success: { bg: colors.verified.bg,   border: colors.verified.border,   icon: "✅", titleColor: colors.verified.text, live: "polite" },
  error:   { bg: "#fee2e2",            border: "#fca5a5",                 icon: "❌", titleColor: "#991b1b",            live: "assertive" },
  warning: { bg: colors.pending.bg,    border: colors.pending.border,     icon: "⚠️", titleColor: colors.pending.text,  live: "assertive" },
  info:    { bg: "#eff6ff",            border: "#93c5fd",                 icon: "ℹ️", titleColor: "#1d4ed8",            live: "polite" },
};

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const cfg = toastConfig[toast.type];

  useEffect(() => {
    // Errors persist until manually dismissed; all others auto-dismiss after 5 s
    if (toast.type === "error") return;
    const t = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(t);
  }, [toast.id, toast.type, onDismiss]);

  return (
    <div
      role={toast.type === "error" || toast.type === "warning" ? "alert" : "status"}
      aria-live={cfg.live}
      aria-atomic="true"
      style={{
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: "0.5rem",
        padding: "0.875rem 1rem",
        display: "flex",
        gap: "0.75rem",
        alignItems: "flex-start",
        boxShadow: "0 4px 12px rgb(0 0 0 / 0.1)",
        minWidth: "300px",
        maxWidth: "420px",
      }}
    >
      <span aria-hidden="true" style={{ fontSize: "1rem", flexShrink: 0 }}>{cfg.icon}</span>
      <div style={{ flex: 1 }}>
        <p style={{ fontWeight: 700, fontSize: "0.875rem", color: cfg.titleColor, margin: 0 }}>
          {toast.title}
        </p>
        {toast.message && (
          <p style={{ fontSize: "0.8rem", color: colors.neutral[600], margin: "0.2rem 0 0" }}>
            {toast.message}
          </p>
        )}
        {toast.txHash && (
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${toast.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="View transaction on Stellar Explorer (opens in new tab)"
            style={{ fontSize: "0.75rem", color: colors.primary[600], fontFamily: "monospace" }}
          >
            View transaction →
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss notification: ${toast.title}`}
        style={{ background: "none", border: "none", cursor: "pointer", color: colors.neutral[400], fontSize: "1rem", padding: 0 }}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}

export default function Toast({ toasts, onDismiss }: Props) {
  return (
    <div
      aria-label="Notifications"
      style={{
        position: "fixed",
        bottom: "1.5rem",
        right: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        zIndex: 9999,
      }}
    >
      {toasts.map(t => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// Hook for managing toasts
export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  function addToast(toast: Omit<ToastMessage, "id">) {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => {
      const next = [...prev, { ...toast, id }];
      // Keep at most 3 toasts; drop the oldest when over the limit
      return next.length > 3 ? next.slice(next.length - 3) : next;
    });
  }

  function dismiss(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id));
  }

  return { toasts, addToast, dismiss };
}
