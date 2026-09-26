"use client";

import { useEffect, useRef } from "react";
import { colors } from "../styles/design-system";

export interface ShortcutEntry {
  keys: string;
  description: string;
}

export const SHORTCUTS: ShortcutEntry[] = [
  { keys: "/", description: "Focus the search box" },
  { keys: "?", description: "Show this shortcuts panel" },
  { keys: "Esc", description: "Close a dialog or this panel" },
];

interface Props {
  onClose: () => void;
}

/**
 * The "?" shortcuts help dialog. Traps focus while open and restores it to
 * whatever triggered it on close, matching the pattern used by the other
 * modals in this app (see MarketplaceFilter's mobile filter modal).
 */
export default function KeyboardShortcutsHelp({ onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => trigger?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const nodes = Array.from(
      dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')
    );
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    }
    if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="keyboard-shortcuts-title"
      style={{
        position: "fixed", inset: 0, zIndex: 200,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        style={{
          background: colors.surface,
          borderRadius: "0.75rem",
          padding: "1.5rem",
          width: "100%",
          maxWidth: "360px",
          boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h2 id="keyboard-shortcuts-title" style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: colors.neutral[900] }}>
            Keyboard shortcuts
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{ background: "none", border: "none", fontSize: "1.1rem", cursor: "pointer", color: colors.neutral[600] }}
          >
            ✕
          </button>
        </div>

        <dl style={{ margin: 0, display: "grid", gap: "0.65rem" }}>
          {SHORTCUTS.map((s) => (
            <div key={s.keys} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem" }}>
              <dt style={{ color: colors.neutral[600], fontSize: "0.875rem" }}>{s.description}</dt>
              <dd style={{
                margin: 0, fontFamily: "monospace", fontSize: "0.8rem", fontWeight: 700,
                color: colors.neutral[800], background: colors.neutral[100],
                border: `1px solid ${colors.neutral[200]}`, borderRadius: "0.375rem",
                padding: "0.15rem 0.5rem", minWidth: "1.75rem", textAlign: "center",
              }}>
                {s.keys}
              </dd>
            </div>
          ))}
        </dl>

        <p style={{ marginTop: "1.25rem", marginBottom: 0, fontSize: "0.75rem", color: colors.neutral[400] }}>
          Shortcuts are disabled while typing in a text field.
        </p>
      </div>
    </div>
  );
}
