"use client";

import { useState, useMemo, useRef } from "react";
import { colors } from "../styles/design-system";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EventType =
  | "registered"
  | "verified"
  | "monitored"
  | "minted"
  | "listed"
  | "purchased"
  | "transferred"
  | "retired";

export type ActorRole =
  | "developer"
  | "verifier"
  | "oracle"
  | "seller"
  | "buyer"
  | "beneficiary"
  | "unknown";

export interface ProvenanceEvent {
  type: EventType;
  label: string;
  timestamp: string;
  actor?: string;
  actorRole?: ActorRole;
  txHash?: string;
  detail?: string;
  /** Optional parent event index for tree view */
  parentIndex?: number;
  /** Extra metadata key/value pairs */
  metadata?: Record<string, string>;
}

export interface ProvenanceFilters {
  dateFrom: string;
  dateTo: string;
  status: EventType | "";
  actorRole: ActorRole | "";
  actorSearch: string;
}

export type ViewMode = "timeline" | "tree";

interface Props {
  events: ProvenanceEvent[] | null;
  /** Optional credit/project metadata shown in PDF header */
  creditId?: string;
  projectName?: string;
}

// ─── Event Config ─────────────────────────────────────────────────────────────

export const EVENT_CONFIG: Record<EventType, { icon: string; color: string; label: string; role: string }> = {
  registered:  { icon: "📋", color: "#6b7280", label: "Registered",  role: "Developer" },
  verified:    { icon: "✅", color: "#16a34a", label: "Verified",    role: "Verifier"  },
  monitored:   { icon: "🛰️", color: "#0891b2", label: "Monitored",   role: "Oracle"    },
  minted:      { icon: "🌱", color: "#15803d", label: "Minted",      role: "System"    },
  listed:      { icon: "🏪", color: "#2563eb", label: "Listed",      role: "Seller"    },
  purchased:   { icon: "💼", color: "#7c3aed", label: "Purchased",   role: "Buyer"     },
  transferred: { icon: "↔️", color: "#0e7490", label: "Transferred", role: "Owner"     },
  retired:     { icon: "🔒", color: "#166534", label: "Retired",     role: "Beneficiary" },
};

export const ACTOR_ROLE_LABELS: Record<ActorRole, string> = {
  developer:   "Developer",
  verifier:    "Verifier",
  oracle:      "Oracle",
  seller:      "Seller",
  buyer:       "Buyer",
  beneficiary: "Beneficiary",
  unknown:     "Unknown",
};

// ─── Filtering ────────────────────────────────────────────────────────────────

export function applyFilters(
  events: ProvenanceEvent[],
  filters: ProvenanceFilters
): ProvenanceEvent[] {
  return events.filter((ev) => {
    // Date from
    if (filters.dateFrom) {
      if (new Date(ev.timestamp) < new Date(filters.dateFrom)) return false;
    }
    // Date to
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(ev.timestamp) > to) return false;
    }
    // Status / event type
    if (filters.status && ev.type !== filters.status) return false;
    // Actor role
    if (filters.actorRole && ev.actorRole !== filters.actorRole) return false;
    // Actor text search
    if (filters.actorSearch) {
      const q = filters.actorSearch.toLowerCase();
      if (!ev.actor?.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const EMPTY_FILTERS: ProvenanceFilters = {
  dateFrom: "",
  dateTo: "",
  status: "",
  actorRole: "",
  actorSearch: "",
};

export function hasActiveFilters(f: ProvenanceFilters): boolean {
  return (
    !!f.dateFrom ||
    !!f.dateTo ||
    !!f.status ||
    !!f.actorRole ||
    !!f.actorSearch
  );
}

// ─── FilterBar ────────────────────────────────────────────────────────────────

interface FilterBarProps {
  filters: ProvenanceFilters;
  onChange: (f: ProvenanceFilters) => void;
  onClear: () => void;
  allActorRoles: ActorRole[];
}

function FilterBar({ filters, onChange, onClear, allActorRoles }: FilterBarProps) {
  const inputStyle: React.CSSProperties = {
    border: `1px solid ${colors.neutral[300]}`,
    borderRadius: "0.375rem",
    padding: "0.4rem 0.6rem",
    fontSize: "0.8rem",
    color: colors.neutral[800],
    background: colors.surface,
    minWidth: 0,
  };

  return (
    <div
      role="search"
      aria-label="Filter provenance events"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
        padding: "0.75rem",
        background: colors.neutral[50],
        border: `1px solid ${colors.neutral[200]}`,
        borderRadius: "0.5rem",
        marginBottom: "1rem",
        alignItems: "flex-end",
      }}
    >
      {/* Date From */}
      <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.7rem", color: colors.neutral[500], fontWeight: 600 }}>
        FROM
        <input
          type="date"
          aria-label="Filter from date"
          value={filters.dateFrom}
          onChange={(e) => onChange({ ...filters, dateFrom: e.target.value })}
          style={inputStyle}
        />
      </label>

      {/* Date To */}
      <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.7rem", color: colors.neutral[500], fontWeight: 600 }}>
        TO
        <input
          type="date"
          aria-label="Filter to date"
          value={filters.dateTo}
          onChange={(e) => onChange({ ...filters, dateTo: e.target.value })}
          style={inputStyle}
        />
      </label>

      {/* Event type */}
      <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.7rem", color: colors.neutral[500], fontWeight: 600 }}>
        EVENT TYPE
        <select
          aria-label="Filter by event type"
          value={filters.status}
          onChange={(e) => onChange({ ...filters, status: e.target.value as EventType | "" })}
          style={inputStyle}
        >
          <option value="">All types</option>
          {(Object.keys(EVENT_CONFIG) as EventType[]).map((t) => (
            <option key={t} value={t}>{EVENT_CONFIG[t].label}</option>
          ))}
        </select>
      </label>

      {/* Actor role */}
      <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.7rem", color: colors.neutral[500], fontWeight: 600 }}>
        ACTOR ROLE
        <select
          aria-label="Filter by actor role"
          value={filters.actorRole}
          onChange={(e) => onChange({ ...filters, actorRole: e.target.value as ActorRole | "" })}
          style={inputStyle}
        >
          <option value="">All roles</option>
          {allActorRoles.map((r) => (
            <option key={r} value={r}>{ACTOR_ROLE_LABELS[r]}</option>
          ))}
        </select>
      </label>

      {/* Actor search */}
      <label style={{ display: "flex", flexDirection: "column", gap: "0.2rem", fontSize: "0.7rem", color: colors.neutral[500], fontWeight: 600 }}>
        ACTOR ADDRESS
        <input
          type="search"
          aria-label="Search by actor address"
          placeholder="Search actor…"
          value={filters.actorSearch}
          onChange={(e) => onChange({ ...filters, actorSearch: e.target.value })}
          style={{ ...inputStyle, minWidth: "140px" }}
        />
      </label>

      {/* Clear */}
      {hasActiveFilters(filters) && (
        <button
          onClick={onClear}
          aria-label="Clear all filters"
          style={{
            marginLeft: "auto",
            padding: "0.4rem 0.75rem",
            border: `1px solid ${colors.neutral[300]}`,
            borderRadius: "0.375rem",
            background: "transparent",
            color: colors.neutral[500],
            fontSize: "0.75rem",
            cursor: "pointer",
            alignSelf: "flex-end",
          }}
        >
          ✕ Clear
        </button>
      )}
    </div>
  );
}

// ─── EventCard ────────────────────────────────────────────────────────────────

interface EventCardProps {
  event: ProvenanceEvent;
  index: number;
  isExpanded: boolean;
  onToggle: (i: number) => void;
}

function EventCard({ event, index, isExpanded, onToggle }: EventCardProps) {
  const cfg = EVENT_CONFIG[event.type];
  const isRetired = event.type === "retired";

  return (
    <div
      data-testid="timeline-item"
      style={{
        background: isRetired ? "#f0fdf4" : colors.surface,
        border: `1px solid ${isRetired ? "#bbf7d0" : colors.neutral[200]}`,
        borderRadius: "0.5rem",
        overflow: "hidden",
        transition: "box-shadow 0.15s",
      }}
    >
      {/* Header row — always visible, clickable */}
      <button
        onClick={() => onToggle(index)}
        aria-expanded={isExpanded}
        aria-controls={`prov-detail-${index}`}
        style={{
          display: "flex",
          width: "100%",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.75rem 1rem",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          gap: "0.5rem",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "0.875rem", color: isRetired ? "#166534" : colors.neutral[800] }}>
          {event.label}
          {isRetired && (
            <span
              aria-label="Finalized"
              style={{
                marginLeft: "0.4rem",
                fontSize: "0.7rem",
                background: "#dcfce7",
                color: "#166534",
                borderRadius: "0.25rem",
                padding: "0.1rem 0.4rem",
                fontWeight: 700,
              }}
            >
              FINALIZED
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.75rem", color: colors.neutral[400], whiteSpace: "nowrap" }}>
            {formatDate(event.timestamp)}
          </span>
          <span aria-hidden="true" style={{ fontSize: "0.7rem", color: colors.neutral[400] }}>
            {isExpanded ? "▲" : "▼"}
          </span>
        </span>
      </button>

      {/* Collapsed preview: actor only */}
      {!isExpanded && event.actor && (
        <p style={{ padding: "0 1rem 0.6rem", fontSize: "0.75rem", color: colors.neutral[500], margin: 0, fontFamily: "monospace" }}>
          {truncateAddress(event.actor)}
          {event.actorRole && ` · ${ACTOR_ROLE_LABELS[event.actorRole]}`}
        </p>
      )}

      {/* Expanded detail panel */}
      {isExpanded && (
        <div
          id={`prov-detail-${index}`}
          role="region"
          aria-label={`Details for ${event.label}`}
          style={{
            padding: "0 1rem 1rem",
            borderTop: `1px solid ${colors.neutral[100]}`,
          }}
        >
          <dl style={{ margin: "0.75rem 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.3rem 1rem", fontSize: "0.8rem" }}>
            <dt style={{ color: colors.neutral[500], fontWeight: 600, whiteSpace: "nowrap" }}>Time</dt>
            <dd style={{ margin: 0, color: colors.neutral[700] }}>{formatDateTime(event.timestamp)}</dd>

            {event.actor && (
              <>
                <dt style={{ color: colors.neutral[500], fontWeight: 600 }}>Actor</dt>
                <dd style={{ margin: 0, color: colors.neutral[700], fontFamily: "monospace", wordBreak: "break-all" }}>
                  {event.actor}
                  {event.actorRole && (
                    <span style={{ marginLeft: "0.5rem", fontFamily: "sans-serif", fontSize: "0.7rem", background: colors.neutral[100], borderRadius: "0.25rem", padding: "0.1rem 0.3rem" }}>
                      {ACTOR_ROLE_LABELS[event.actorRole]}
                    </span>
                  )}
                </dd>
              </>
            )}

            {event.detail && (
              <>
                <dt style={{ color: colors.neutral[500], fontWeight: 600 }}>Detail</dt>
                <dd style={{ margin: 0, color: colors.neutral[700] }}>{event.detail}</dd>
              </>
            )}

            {event.txHash && (
              <>
                <dt style={{ color: colors.neutral[500], fontWeight: 600 }}>Tx Hash</dt>
                <dd style={{ margin: 0 }}>
                  <a
                    href={`https://stellar.expert/explorer/testnet/tx/${event.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`View ${event.label} transaction on Stellar Explorer`}
                    style={{ fontSize: "0.75rem", color: "#2563eb", fontFamily: "monospace", wordBreak: "break-all" }}
                  >
                    {event.txHash}
                  </a>
                </dd>
              </>
            )}

            {event.metadata && Object.entries(event.metadata).map(([k, v]) => (
              <>
                <dt key={`k-${k}`} style={{ color: colors.neutral[500], fontWeight: 600, textTransform: "capitalize" }}>{k}</dt>
                <dd key={`v-${k}`} style={{ margin: 0, color: colors.neutral[700] }}>{v}</dd>
              </>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}

// ─── TimelineView ─────────────────────────────────────────────────────────────

interface TimelineViewProps {
  events: ProvenanceEvent[];
  expandedSet: Set<number>;
  onToggle: (i: number) => void;
}

function TimelineView({ events, expandedSet, onToggle }: TimelineViewProps) {
  return (
    <div style={{ position: "relative", paddingLeft: "2.25rem" }}>
      {/* Vertical rail */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "0.65rem",
          top: "0.75rem",
          bottom: "0.75rem",
          width: "2px",
          background: `linear-gradient(to bottom, ${colors.primary[200]}, ${colors.primary[400]})`,
          borderRadius: "1px",
        }}
      />

      {events.map((event, i) => {
        const cfg = EVENT_CONFIG[event.type];
        return (
          <div key={i} style={{ position: "relative", marginBottom: i < events.length - 1 ? "1.25rem" : 0 }}>
            {/* Timeline dot */}
            <div
              aria-hidden="true"
              title={cfg.label}
              style={{
                position: "absolute",
                left: "-1.7rem",
                top: "0.8rem",
                width: "1.25rem",
                height: "1.25rem",
                background: cfg.color,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "0.55rem",
                border: "2px solid white",
                boxShadow: `0 0 0 3px ${cfg.color}30`,
                zIndex: 1,
              }}
            >
              {cfg.icon}
            </div>

            <EventCard
              event={event}
              index={i}
              isExpanded={expandedSet.has(i)}
              onToggle={onToggle}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── TreeView ─────────────────────────────────────────────────────────────────

interface TreeNode {
  event: ProvenanceEvent;
  originalIndex: number;
  children: TreeNode[];
}

function buildTree(events: ProvenanceEvent[]): TreeNode[] {
  const nodes: TreeNode[] = events.map((ev, i) => ({ event: ev, originalIndex: i, children: [] }));
  const roots: TreeNode[] = [];

  nodes.forEach((node) => {
    const parent = node.event.parentIndex;
    if (parent !== undefined && parent >= 0 && parent < nodes.length) {
      nodes[parent].children.push(node);
    } else {
      // Auto-assign hierarchy by type order when no explicit parent
      roots.push(node);
    }
  });

  // If no explicit parent links, fall back to linear nesting by type
  if (events.every((e) => e.parentIndex === undefined)) {
    const TYPE_ORDER: EventType[] = ["registered", "verified", "monitored", "minted", "listed", "purchased", "transferred", "retired"];
    const sorted = [...nodes].sort(
      (a, b) => TYPE_ORDER.indexOf(a.event.type) - TYPE_ORDER.indexOf(b.event.type)
    );
    // nest each under the previous
    if (sorted.length === 0) return [];
    let current = sorted[0];
    const tree = [current];
    for (let i = 1; i < sorted.length; i++) {
      current.children.push(sorted[i]);
      current = sorted[i];
    }
    return tree;
  }

  return roots;
}

interface TreeNodeViewProps {
  node: TreeNode;
  depth: number;
  expandedSet: Set<number>;
  onToggle: (i: number) => void;
}

function TreeNodeView({ node, depth, expandedSet, onToggle }: TreeNodeViewProps) {
  const cfg = EVENT_CONFIG[node.event.type];
  return (
    <div style={{ paddingLeft: depth > 0 ? "1.5rem" : 0 }}>
      <div style={{ position: "relative" }}>
        {depth > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-1rem",
              top: 0,
              bottom: node.children.length > 0 ? "50%" : 0,
              width: "1px",
              background: colors.neutral[200],
            }}
          />
        )}
        {depth > 0 && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: "-1rem",
              top: "1.25rem",
              width: "1rem",
              height: "1px",
              background: colors.neutral[200],
            }}
          />
        )}

        {/* Type badge */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
          <span
            aria-hidden="true"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.25rem",
              padding: "0.15rem 0.5rem",
              background: `${cfg.color}15`,
              border: `1px solid ${cfg.color}40`,
              borderRadius: "0.25rem",
              fontSize: "0.7rem",
              fontWeight: 700,
              color: cfg.color,
              whiteSpace: "nowrap",
            }}
          >
            {cfg.icon} {cfg.label}
          </span>
        </div>

        <EventCard
          event={node.event}
          index={node.originalIndex}
          isExpanded={expandedSet.has(node.originalIndex)}
          onToggle={onToggle}
        />
      </div>

      {node.children.map((child) => (
        <TreeNodeView
          key={child.originalIndex}
          node={child}
          depth={depth + 1}
          expandedSet={expandedSet}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

interface TreeViewProps {
  events: ProvenanceEvent[];
  expandedSet: Set<number>;
  onToggle: (i: number) => void;
}

function TreeView({ events, expandedSet, onToggle }: TreeViewProps) {
  const tree = useMemo(() => buildTree(events), [events]);
  return (
    <div>
      {tree.map((node) => (
        <TreeNodeView
          key={node.originalIndex}
          node={node}
          depth={0}
          expandedSet={expandedSet}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

export async function exportProvenancePdf(
  events: ProvenanceEvent[],
  creditId?: string,
  projectName?: string
): Promise<void> {
  const { default: jsPDF } = await import("jspdf");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const margin = 16;
  const colW = pageW - margin * 2;
  let y = margin;

  // Header
  doc.setFontSize(18);
  doc.setTextColor(22, 101, 52); // primary-800
  doc.text("CarbonLedger — Provenance Trail", margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  if (projectName) { doc.text(`Project: ${projectName}`, margin, y); y += 5; }
  if (creditId)    { doc.text(`Credit ID: ${creditId}`,   margin, y); y += 5; }
  doc.text(`Exported: ${new Date().toLocaleString()}`, margin, y);
  y += 5;
  doc.text(`Total events: ${events.length}`, margin, y);
  y += 8;

  // Divider
  doc.setDrawColor(220, 252, 231);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // Events
  events.forEach((ev, i) => {
    // Page break guard
    if (y > 270) {
      doc.addPage();
      y = margin;
    }

    const cfg = EVENT_CONFIG[ev.type];

    doc.setFontSize(11);
    doc.setTextColor(22, 101, 52);
    doc.text(`${i + 1}. ${ev.label}`, margin, y);
    y += 5;

    doc.setFontSize(9);
    doc.setTextColor(107, 114, 128);
    doc.text(`Type: ${cfg.label}   |   Date: ${formatDateTime(ev.timestamp)}`, margin + 3, y);
    y += 4.5;

    if (ev.actor) {
      doc.text(`Actor: ${ev.actor}${ev.actorRole ? ` (${ACTOR_ROLE_LABELS[ev.actorRole]})` : ""}`, margin + 3, y);
      y += 4.5;
    }

    if (ev.detail) {
      const lines = doc.splitTextToSize(`Detail: ${ev.detail}`, colW - 3);
      doc.text(lines, margin + 3, y);
      y += lines.length * 4.5;
    }

    if (ev.txHash) {
      doc.text(`Tx: ${ev.txHash}`, margin + 3, y);
      y += 4.5;
    }

    if (ev.metadata) {
      Object.entries(ev.metadata).forEach(([k, v]) => {
        doc.text(`${k}: ${v}`, margin + 3, y);
        y += 4.5;
      });
    }

    y += 4;

    // Thin separator
    if (i < events.length - 1) {
      doc.setDrawColor(243, 244, 246);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
    }
  });

  // Footer on each page
  const pageCount = (doc as any).internal.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175);
    doc.text(
      `CarbonLedger Provenance Trail — Page ${p} of ${pageCount}`,
      pageW / 2,
      290,
      { align: "center" }
    );
  }

  doc.save(`CarbonLedger-Provenance-${creditId ?? "trail"}-${new Date().toISOString().slice(0, 10)}.pdf`);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ProvenanceTrail({ events, creditId, projectName }: Props) {
  const [view, setView] = useState<ViewMode>("timeline");
  const [filters, setFilters] = useState<ProvenanceFilters>(EMPTY_FILTERS);
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);
  const trailRef = useRef<HTMLDivElement>(null);

  // All unique actor roles present in the data
  const allActorRoles = useMemo<ActorRole[]>(() => {
    const roles = new Set<ActorRole>();
    (events ?? []).forEach((e) => { if (e.actorRole) roles.add(e.actorRole); });
    return Array.from(roles).sort();
  }, [events]);

  // Filtered events
  const filtered = useMemo<ProvenanceEvent[]>(() => {
    if (!events || events.length === 0) return [];
    return applyFilters(events, filters);
  }, [events, filters]);

  function toggleExpand(i: number) {
    setExpandedSet((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  }

  function expandAll() {
    setExpandedSet(new Set(filtered.map((_, i) => i)));
  }

  function collapseAll() {
    setExpandedSet(new Set());
  }

  async function handleExportPdf() {
    setExporting(true);
    try {
      await exportProvenancePdf(filtered, creditId, projectName);
    } finally {
      setExporting(false);
    }
  }

  // Empty state
  if (!events || events.length === 0) {
    return (
      <div
        style={{
          textAlign: "center",
          padding: "2.5rem 1rem",
          border: `1px dashed ${colors.neutral[300]}`,
          borderRadius: "0.75rem",
          color: colors.neutral[400],
        }}
      >
        <p style={{ fontSize: "2rem", margin: "0 0 0.5rem" }}>🔍</p>
        <p style={{ fontWeight: 600, color: colors.neutral[600], margin: "0 0 0.25rem" }}>
          No provenance events found
        </p>
        <p style={{ fontSize: "0.875rem", margin: 0 }}>
          No on-chain events have been recorded for this credit yet.
        </p>
      </div>
    );
  }

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: "0.4rem 0.9rem",
    border: `1px solid ${active ? colors.primary[500] : colors.neutral[300]}`,
    borderRadius: "0.375rem",
    background: active ? colors.primary[50] : "transparent",
    color: active ? colors.primary[700] : colors.neutral[500],
    fontSize: "0.8rem",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
  });

  return (
    <div ref={trailRef} style={{ width: "100%", boxSizing: "border-box" }}>
      <style>{`
        @media (max-width: 480px) {
          .pt-toolbar { flex-direction: column !important; align-items: stretch !important; }
          .pt-toolbar-actions { justify-content: flex-start !important; }
        }
      `}</style>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div
        className="pt-toolbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        {/* View toggle */}
        <div role="group" aria-label="View mode" style={{ display: "flex", gap: "0.4rem" }}>
          <button
            onClick={() => setView("timeline")}
            aria-pressed={view === "timeline"}
            style={tabStyle(view === "timeline")}
          >
            📅 Timeline
          </button>
          <button
            onClick={() => setView("tree")}
            aria-pressed={view === "tree"}
            style={tabStyle(view === "tree")}
          >
            🌳 Tree
          </button>
        </div>

        {/* Actions */}
        <div className="pt-toolbar-actions" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          <button onClick={expandAll}   style={{ ...tabStyle(false), fontSize: "0.75rem" }}>Expand all</button>
          <button onClick={collapseAll} style={{ ...tabStyle(false), fontSize: "0.75rem" }}>Collapse all</button>
          <button
            onClick={handleExportPdf}
            disabled={exporting || filtered.length === 0}
            aria-label="Export provenance trail as PDF"
            style={{
              padding: "0.4rem 0.9rem",
              border: "none",
              borderRadius: "0.375rem",
              background: filtered.length === 0 ? colors.neutral[200] : colors.primary[600],
              color: filtered.length === 0 ? colors.neutral[400] : "#fff",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: filtered.length === 0 ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {exporting ? "Exporting…" : "⬇ PDF"}
          </button>
        </div>
      </div>

      {/* ── Filter bar ─────────────────────────────────────────────────────── */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(EMPTY_FILTERS)}
        allActorRoles={allActorRoles}
      />

      {/* ── Result count ───────────────────────────────────────────────────── */}
      <p
        role="status"
        aria-live="polite"
        style={{ fontSize: "0.8rem", color: colors.neutral[500], margin: "0 0 0.75rem" }}
      >
        {filtered.length} of {events.length} event{events.length !== 1 ? "s" : ""}
        {hasActiveFilters(filters) ? " (filtered)" : ""}
      </p>

      {/* ── No results ─────────────────────────────────────────────────────── */}
      {filtered.length === 0 && (
        <p style={{ textAlign: "center", color: colors.neutral[400], padding: "2rem", fontSize: "0.875rem" }}>
          No events match the current filters.
        </p>
      )}

      {/* ── Visualization ──────────────────────────────────────────────────── */}
      {filtered.length > 0 && view === "timeline" && (
        <TimelineView events={filtered} expandedSet={expandedSet} onToggle={toggleExpand} />
      )}
      {filtered.length > 0 && view === "tree" && (
        <TreeView events={filtered} expandedSet={expandedSet} onToggle={toggleExpand} />
      )}
    </div>
  );
}

export default ProvenanceTrail;
