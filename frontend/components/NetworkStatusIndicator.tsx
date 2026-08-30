"use client";

/**
 * NetworkStatusIndicator
 *
 * A sticky banner / pill that:
 *   - Shows nothing when online and no conflicts
 *   - Shows an amber "Offline — showing cached data" banner when offline
 *   - Shows a green "Back online — syncing…" flash on reconnect
 *   - Shows a yellow conflict count badge when merge conflicts are detected
 */

import { useEffect, useState } from "react";
import { colors } from "../styles/design-system";
import type { SyncStatus, ConflictRecord } from "../hooks/useAuditSync";

export interface NetworkStatusIndicatorProps {
  isOnline: boolean;
  syncStatus: SyncStatus;
  conflicts: ConflictRecord[];
  lastSyncAt: number | null;
  onDismissConflicts: () => void;
  onManualSync: () => void;
}

export default function NetworkStatusIndicator({
  isOnline,
  syncStatus,
  conflicts,
  lastSyncAt,
  onDismissConflicts,
  onManualSync,
}: NetworkStatusIndicatorProps) {
  // Show "back online" flash for 3 s after re-connecting
  const [showOnlineFlash, setShowOnlineFlash] = useState(false);

  useEffect(() => {
    if (isOnline && syncStatus === "success") {
      setShowOnlineFlash(true);
      const t = setTimeout(() => setShowOnlineFlash(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isOnline, syncStatus]);

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  // ── Offline banner ──────────────────────────────────────────────────────────
  if (!isOnline) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Network status: offline"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.6rem 1rem",
          background: "#92400e",
          color: "#fef3c7",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        <span aria-hidden="true">📵</span>
        <span>You&apos;re offline — showing cached audit data</span>
        <button
          onClick={onManualSync}
          style={{
            marginLeft: "auto",
            padding: "0.2rem 0.75rem",
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "0.375rem",
            color: "#fef3c7",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Syncing indicator ───────────────────────────────────────────────────────
  if (syncStatus === "syncing") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Syncing audit data"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.6rem 1rem",
          background: colors.primary[700],
          color: "#fff",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            animation: "spin 1s linear infinite",
            width: "1rem",
            height: "1rem",
            border: "2px solid rgba(255,255,255,0.4)",
            borderTopColor: "#fff",
            borderRadius: "50%",
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        Syncing audit data…
      </div>
    );
  }

  // ── Conflict banner ─────────────────────────────────────────────────────────
  if (conflicts.length > 0) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.6rem 1rem",
          background: "#78350f",
          color: "#fef3c7",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        <span aria-hidden="true">⚠️</span>
        <span>
          {conflicts.length} record{conflicts.length !== 1 ? "s" : ""} updated
          since your last session — local cache merged with server version.
        </span>
        <button
          onClick={onDismissConflicts}
          aria-label="Dismiss conflict notification"
          style={{
            marginLeft: "auto",
            padding: "0.2rem 0.75rem",
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "0.375rem",
            color: "#fef3c7",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  // ── Sync error ──────────────────────────────────────────────────────────────
  if (syncStatus === "error") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.6rem 1rem",
          background: "#991b1b",
          color: "#fee2e2",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        <span aria-hidden="true">❌</span>
        <span>Sync failed — showing cached data</span>
        <button
          onClick={onManualSync}
          style={{
            marginLeft: "auto",
            padding: "0.2rem 0.75rem",
            background: "rgba(255,255,255,0.15)",
            border: "1px solid rgba(255,255,255,0.3)",
            borderRadius: "0.375rem",
            color: "#fee2e2",
            fontSize: "0.75rem",
            cursor: "pointer",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Online flash (brief success message) ────────────────────────────────────
  if (showOnlineFlash) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.6rem 1rem",
          background: "#14532d",
          color: "#bbf7d0",
          fontSize: "0.875rem",
          fontWeight: 500,
        }}
      >
        <span aria-hidden="true">✅</span>
        <span>
          Back online — data synced
          {lastSyncAt ? ` at ${formatTime(lastSyncAt)}` : ""}
        </span>
      </div>
    );
  }

  // ── Nothing to show ─────────────────────────────────────────────────────────
  return null;
}
