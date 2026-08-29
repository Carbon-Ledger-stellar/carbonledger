"use client";

/**
 * AuditExplorer — offline-first credit audit explorer
 *
 * Offline strategy:
 *   1. On first load (online), fetch from API via SWR and populate IndexedDB cache.
 *   2. When offline, read from IndexedDB cache and show a status indicator.
 *   3. On reconnect, trigger a sync with conflict detection.
 *   4. Users can export the current filtered view as JSON for offline sharing.
 */

import { useState, useEffect, useMemo } from "react";
import { useRetirements, RetirementRecord } from "../lib/api";
import { formatTonnes } from "../lib/carbon-utils";
import { colors } from "../styles/design-system";
import { useAuditCache } from "../hooks/useAuditCache";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { useAuditSync } from "../hooks/useAuditSync";
import NetworkStatusIndicator from "./NetworkStatusIndicator";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type FilterField = "all" | "project" | "batch";

// ─────────────────────────────────────────────────────────────────────────────
// JSON Export helper
// ─────────────────────────────────────────────────────────────────────────────

function exportToJson(records: RetirementRecord[], filename = "audit-export.json") {
  const payload = {
    exportedAt: new Date().toISOString(),
    source: "CarbonLedger Audit Explorer",
    recordCount: records.length,
    records,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AuditExplorer() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterField>("all");

  // ── Network & sync ─────────────────────────────────────────────────────────
  const { isOnline } = useNetworkStatus();
  const {
    syncStatus,
    lastSyncAt,
    conflicts,
    triggerSync,
    dismissConflicts,
  } = useAuditSync();

  // ── Remote data (SWR) ──────────────────────────────────────────────────────
  const {
    data: remoteRetirements,
    isLoading: remoteLoading,
  } = useRetirements(100);

  // ── Offline cache ──────────────────────────────────────────────────────────
  const {
    retirements: cachedRetirements,
    isReady: cacheReady,
    putRetirements,
    storageUsedBytes,
  } = useAuditCache();

  // Populate IDB cache whenever we get fresh remote data
  useEffect(() => {
    if (remoteRetirements && remoteRetirements.length > 0) {
      putRetirements(remoteRetirements);
    }
  }, [remoteRetirements, putRetirements]);

  // ── Merge: prefer remote data when online, fall back to cache offline ──────
  const retirements = useMemo<RetirementRecord[]>(() => {
    if (isOnline && remoteRetirements && remoteRetirements.length > 0) {
      return remoteRetirements;
    }
    return cachedRetirements;
  }, [isOnline, remoteRetirements, cachedRetirements]);

  const isLoading = isOnline ? remoteLoading : !cacheReady;
  const isOfflineMode = !isOnline && cachedRetirements.length > 0;

  // ── Filter ─────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return retirements.filter((r) => {
      if (!query) return true;
      const q = query.toLowerCase();
      if (filter === "project") return r.projectId.toLowerCase().includes(q);
      if (filter === "batch") return r.batchId.toLowerCase().includes(q);
      return (
        r.projectId.toLowerCase().includes(q) ||
        r.batchId.toLowerCase().includes(q) ||
        r.retirementId.toLowerCase().includes(q) ||
        r.beneficiary.toLowerCase().includes(q)
      );
    });
  }, [retirements, query, filter]);

  // ── Storage display ────────────────────────────────────────────────────────
  const storageMB = (storageUsedBytes / (1024 * 1024)).toFixed(1);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Network / sync status banner */}
      <NetworkStatusIndicator
        isOnline={isOnline}
        syncStatus={syncStatus}
        conflicts={conflicts}
        lastSyncAt={lastSyncAt}
        onDismissConflicts={dismissConflicts}
        onManualSync={triggerSync}
      />

      {/* Offline mode notice */}
      {isOfflineMode && (
        <p
          role="status"
          aria-live="polite"
          style={{
            padding: "0.5rem 1rem",
            background: colors.primary[50],
            borderRadius: "0.5rem",
            fontSize: "0.8rem",
            color: colors.primary[700],
            marginBottom: "0.75rem",
          }}
        >
          📦 Showing {cachedRetirements.length} locally cached records
          {lastSyncAt &&
            ` · Last synced ${new Date(lastSyncAt).toLocaleTimeString()}`}
          {storageUsedBytes > 0 && ` · ${storageMB} MB used`}
        </p>
      )}

      {/* Search bar + actions */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.75rem",
          marginBottom: "1rem",
          alignItems: "center",
        }}
      >
        <label
          htmlFor="audit-search"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
          }}
        >
          Search audit trail
        </label>
        <input
          id="audit-search"
          type="search"
          aria-label="Search by project, batch, retirement ID, or beneficiary"
          placeholder="Search by project, batch, retirement ID, or beneficiary…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: "1 1 200px",
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.5rem",
            padding: "0.6rem 1rem",
            fontSize: "0.875rem",
            color: colors.neutral[800],
          }}
        />
        <label
          htmlFor="audit-filter"
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            overflow: "hidden",
            clip: "rect(0,0,0,0)",
            whiteSpace: "nowrap",
          }}
        >
          Filter by field
        </label>
        <select
          id="audit-filter"
          aria-label="Filter search by field"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterField)}
          style={{
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.5rem",
            padding: "0.6rem 0.75rem",
            fontSize: "0.875rem",
            color: colors.neutral[700],
          }}
        >
          <option value="all">All fields</option>
          <option value="project">Project</option>
          <option value="batch">Batch</option>
        </select>

        {/* Manual sync button */}
        <button
          onClick={triggerSync}
          disabled={syncStatus === "syncing" || !isOnline}
          aria-label="Manually sync audit data from server"
          title={!isOnline ? "Sync unavailable offline" : "Sync now"}
          style={{
            padding: "0.6rem 1rem",
            background: isOnline ? colors.primary[50] : colors.neutral[100],
            border: `1px solid ${isOnline ? colors.primary[200] : colors.neutral[300]}`,
            borderRadius: "0.5rem",
            color: isOnline ? colors.primary[700] : colors.neutral[400],
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: isOnline ? "pointer" : "not-allowed",
            whiteSpace: "nowrap",
          }}
        >
          {syncStatus === "syncing" ? "Syncing…" : "↻ Sync"}
        </button>

        {/* Export button */}
        <button
          onClick={() =>
            exportToJson(
              filtered,
              `audit-export-${new Date().toISOString().slice(0, 10)}.json`
            )
          }
          disabled={filtered.length === 0}
          aria-label="Export filtered audit records as JSON"
          style={{
            padding: "0.6rem 1rem",
            background: filtered.length === 0 ? colors.neutral[100] : colors.primary[600],
            border: "none",
            borderRadius: "0.5rem",
            color: filtered.length === 0 ? colors.neutral[400] : "#fff",
            fontSize: "0.8rem",
            fontWeight: 600,
            cursor: filtered.length === 0 ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          ⬇ Export JSON
        </button>
      </div>

      {/* Results */}
      {isLoading ? (
        <p
          style={{
            color: colors.neutral[400],
            textAlign: "center",
            padding: "2rem",
          }}
        >
          {isOnline ? "Loading audit trail…" : "Loading cached records…"}
        </p>
      ) : (
        <>
          <p
            role="status"
            aria-live="polite"
            style={{
              fontSize: "0.8rem",
              color: colors.neutral[500],
              marginBottom: "0.75rem",
            }}
          >
            {filtered.length} record{filtered.length !== 1 ? "s" : ""} found
            {!isOnline && " (offline cache)"}
          </p>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {filtered.length === 0 && (
              <p
                style={{
                  color: colors.neutral[400],
                  textAlign: "center",
                  padding: "2rem",
                }}
              >
                {!isOnline && cachedRetirements.length === 0
                  ? "No cached data available offline. Connect to the internet to load records."
                  : "No records found"}
              </p>
            )}

            {filtered.map((r) => (
              <AuditRecord key={r.retirementId} record={r} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AuditRecord row
// ─────────────────────────────────────────────────────────────────────────────

function AuditRecord({ record: r }: { record: RetirementRecord }) {
  return (
    <div
      style={{
        background: colors.surface,
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: "0.5rem",
        padding: "1rem",
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr auto",
        gap: "1rem",
        alignItems: "center",
      }}
    >
      <div>
        <p
          style={{
            fontSize: "0.7rem",
            color: colors.neutral[400],
            margin: "0 0 0.2rem",
          }}
        >
          Project
        </p>
        <p
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: colors.neutral[800],
            margin: 0,
          }}
        >
          {r.projectId}
        </p>
      </div>
      <div>
        <p
          style={{
            fontSize: "0.7rem",
            color: colors.neutral[400],
            margin: "0 0 0.2rem",
          }}
        >
          Beneficiary
        </p>
        <p
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            color: colors.neutral[800],
            margin: 0,
          }}
        >
          {r.beneficiary}
        </p>
      </div>
      <div>
        <p
          style={{
            fontSize: "0.7rem",
            color: colors.neutral[400],
            margin: "0 0 0.2rem",
          }}
        >
          Amount
        </p>
        <p
          style={{
            fontSize: "0.875rem",
            fontWeight: 700,
            color: colors.primary[700],
            margin: 0,
          }}
        >
          {formatTonnes(r.amount)}
        </p>
      </div>
      <a
        href={`/retire/${r.retirementId}`}
        aria-label={`View certificate for ${r.beneficiary} — ${r.projectId}`}
        style={{
          background: colors.primary[50],
          color: colors.primary[700],
          border: `1px solid ${colors.primary[200]}`,
          borderRadius: "0.375rem",
          padding: "0.4rem 0.75rem",
          fontSize: "0.75rem",
          fontWeight: 600,
          textDecoration: "none",
          whiteSpace: "nowrap",
        }}
      >
        View Certificate
      </a>
    </div>
  );
}
