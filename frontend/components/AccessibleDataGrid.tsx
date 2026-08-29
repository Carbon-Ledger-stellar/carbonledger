'use client';

import { useMemo, useRef, useCallback, useState, useEffect } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render: (row: T) => React.ReactNode;
  /** Optional aria-label override for the column header */
  ariaLabel?: string;
}

interface AccessibleDataGridProps<T> {
  data: T[];
  columns: Column<T>[];
  /** Unique ID for each row (used for selection and key) */
  rowId: (row: T) => string;
  /** Optional: initial sort config */
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  /** Rows per page (default 25) */
  pageSize?: number;
  /** Row height in px for virtualized scrolling (default 52) */
  rowHeight?: number;
  /** Max visible height in px (default 400) */
  maxHeight?: number;
  /** Empty state message */
  emptyMessage?: string;
  /** Loading state */
  loading?: boolean;
  /** Called when row is activated (Enter/Space/click) */
  onRowActivate?: (row: T) => void;
  /** Called when selected row changes */
  onSelectionChange?: (selectedIds: string[]) => void;
}

// ─── Sort helper ───────────────────────────────────────────────────────────────

function sortData<T>(data: T[], sortKey: string | null, sortDir: "asc" | "desc"): T[] {
  if (!sortKey) return data;
  return [...data].sort((a, b) => {
    const aVal = String((a as any)[sortKey] ?? "");
    const bVal = String((b as any)[sortKey] ?? "");
    const cmp = aVal.localeCompare(bVal);
    return sortDir === "asc" ? cmp : -cmp;
  });
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function AccessibleDataGrid<T>({
  data,
  columns,
  rowId,
  defaultSortKey,
  defaultSortDir = "asc",
  pageSize = 25,
  rowHeight = 52,
  maxHeight = 400,
  emptyMessage = "No data available",
  loading = false,
  onRowActivate,
  onSelectionChange,
}: AccessibleDataGridProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(defaultSortKey ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState<number>(-1);
  const gridRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => sortData(data, sortKey, sortDir), [data, sortKey, sortDir]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const currentPage = Math.min(page, totalPages - 1);

  // Sync page when data changes
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [totalPages, page]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " ▲" : " ▼";
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange?.(Array.from(next));
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === pageData.length) {
      setSelectedIds(new Set());
      onSelectionChange?.([]);
    } else {
      const all = new Set(pageData.map(d => rowId(d)));
      setSelectedIds(all);
      onSelectionChange?.(Array.from(all));
    }
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, row: T, rowIdx: number) => {
      const id = rowId(row);
      const totalRows = pageData.length;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setFocusIndex(Math.min(rowIdx + 1, totalRows - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusIndex(Math.max(rowIdx - 1, 0));
          break;
        case " ":
          e.preventDefault();
          toggleSelect(id);
          break;
        case "Enter":
          e.preventDefault();
          onRowActivate?.(row);
          break;
        case "Home":
          e.preventDefault();
          setFocusIndex(0);
          break;
        case "End":
          e.preventDefault();
          setFocusIndex(totalRows - 1);
          break;
      }
    },
    [pageData, rowId, onRowActivate]
  );

  // Scroll focused row into view
  useEffect(() => {
    if (focusIndex >= 0 && gridRef.current) {
      const rowEl = gridRef.current.querySelector(`[data-row-index="${focusIndex}"]`) as HTMLElement | null;
      rowEl?.focus({ preventScroll: false });
    }
  }, [focusIndex]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        role="status"
        aria-label="Loading data"
        style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}
      >
        Loading data…
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div
        role="status"
        aria-label={emptyMessage}
        style={{ padding: "2rem", textAlign: "center", color: "#6b7280" }}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div>
      {/* Grid container */}
      <div
        ref={gridRef}
        role="grid"
        aria-label="Data grid"
        aria-colcount={columns.length}
        aria-rowcount={sorted.length}
        style={{
          maxHeight: `${maxHeight}px`,
          overflowY: "auto",
          border: "1px solid #e5e7eb",
          borderRadius: "0.5rem",
        }}
      >
        {/* Header row */}
        <div role="row" aria-rowindex={1} style={{ display: "flex", background: "#f9fafb", borderBottom: "2px solid #e5e7eb", fontWeight: 600, position: "sticky", top: 0, zIndex: 1 }}>
          <div role="columnheader" aria-label="Select all rows" style={{ width: 40, flexShrink: 0, padding: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <input
              type="checkbox"
              aria-label="Select all rows"
              checked={pageData.length > 0 && selectedIds.size === pageData.length}
              onChange={toggleSelectAll}
            />
          </div>
          {columns.map((col) => (
            <div
              key={col.key}
              role="columnheader"
              aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
              aria-label={col.ariaLabel || col.label}
              style={{
                flex: 1,
                padding: "0.5rem",
                cursor: col.sortable ? "pointer" : "default",
                userSelect: "none",
              }}
              tabIndex={col.sortable ? 0 : undefined}
              onClick={() => col.sortable && toggleSort(col.key)}
              onKeyDown={(e) => { if (e.key === "Enter" && col.sortable) toggleSort(col.key); }}
            >
              {col.label}
              {sortIndicator(col.key)}
            </div>
          ))}
        </div>

        {/* Data rows */}
        {pageData.map((row, idx) => {
          const id = rowId(row);
          const globalIdx = currentPage * pageSize + idx;
          const isSelected = selectedIds.has(id);
          const isFocused = focusIndex === idx;

          return (
            <div
              key={id}
              role="row"
              aria-rowindex={globalIdx + 2}
              aria-selected={isSelected}
              data-row-index={idx}
              tabIndex={isFocused ? 0 : -1}
              style={{
                display: "flex",
                background: isSelected ? "#eef2ff" : isFocused ? "#f3f4f6" : undefined,
                borderBottom: "1px solid #f3f4f6",
                minHeight: rowHeight,
              }}
              onKeyDown={(e) => handleKeyDown(e, row, idx)}
              onClick={() => {
                setFocusIndex(idx);
                toggleSelect(id);
              }}
              onDoubleClick={() => onRowActivate?.(row)}
            >
              <div role="gridcell" style={{ width: 40, flexShrink: 0, padding: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelect(id)}
                  aria-label={`Select row ${globalIdx + 1}`}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              {columns.map((col) => (
                <div
                  key={col.key}
                  role="gridcell"
                  style={{ flex: 1, padding: "0.5rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {col.render(row)}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "0.75rem 0",
            fontSize: "0.875rem",
            color: "#6b7280",
          }}
        >
          <span>
            Showing {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length} rows
          </span>
          <div style={{ display: "flex", gap: "0.25rem" }}>
            <button
              type="button"
              aria-label="Previous page"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              style={{
                padding: "0.35rem 0.65rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.25rem",
                background: "#fff",
                cursor: currentPage === 0 ? "default" : "pointer",
                opacity: currentPage === 0 ? 0.5 : 1,
              }}
            >
              ← Prev
            </button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
              // Show pages around current page
              const start = Math.max(0, Math.min(currentPage - 3, totalPages - 7));
              const pageNum = start + i + 1;
              if (pageNum > totalPages) return null;
              return (
                <button
                  key={pageNum}
                  type="button"
                  aria-label={`Page ${pageNum}`}
                  aria-current={currentPage === pageNum - 1 ? "page" : undefined}
                  onClick={() => setPage(pageNum - 1)}
                  style={{
                    padding: "0.35rem 0.65rem",
                    border: "1px solid #d1d5db",
                    borderRadius: "0.25rem",
                    background: currentPage === pageNum - 1 ? "#3b82f6" : "#fff",
                    color: currentPage === pageNum - 1 ? "#fff" : "#374151",
                    cursor: "pointer",
                    fontWeight: currentPage === pageNum - 1 ? 700 : 400,
                  }}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              type="button"
              aria-label="Next page"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage(currentPage + 1)}
              style={{
                padding: "0.35rem 0.65rem",
                border: "1px solid #d1d5db",
                borderRadius: "0.25rem",
                background: "#fff",
                cursor: currentPage >= totalPages - 1 ? "default" : "pointer",
                opacity: currentPage >= totalPages - 1 ? 0.5 : 1,
              }}
            >
              Next →
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}