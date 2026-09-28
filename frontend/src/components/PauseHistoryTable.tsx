import React, { useMemo, useState } from 'react';
import {
  PauseHistoryEvent,
  PauseHistorySort,
  PauseHistorySortField,
  SortDirection,
} from '../types/pause';

interface PauseHistoryTableProps {
  events: PauseHistoryEvent[];
  page?: number;
  pageSize?: number;
  total?: number;
  sort?: PauseHistorySort;
  onPageChange?: (page: number) => void;
  onSortChange?: (sort: PauseHistorySort) => void;
  onExportCsv?: (events: PauseHistoryEvent[]) => void;
}

const DEFAULT_PAGE_SIZE = 10;

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }
  return date.toLocaleString();
}

function formatDuration(durationMs?: number): string {
  if (durationMs === undefined || durationMs === null) {
    return '—';
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function compareEvents(
  a: PauseHistoryEvent,
  b: PauseHistoryEvent,
  sort: PauseHistorySort,
): number {
  const dir = sort.direction === 'asc' ? 1 : -1;
  switch (sort.field) {
    case 'adminName':
      return a.adminName.localeCompare(b.adminName) * dir;
    case 'action':
      return a.action.localeCompare(b.action) * dir;
    case 'timestamp':
    default:
      return (new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) * dir;
  }
}

function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function buildCsv(events: PauseHistoryEvent[]): string {
  const header = ['Action', 'Admin', 'Timestamp', 'Duration', 'Reason'];
  const rows = events.map((event) => [
    event.action,
    event.adminName,
    event.timestamp,
    formatDuration(event.durationMs),
    event.reason ?? '',
  ]);
  return [header, ...rows]
    .map((row) => row.map((cell) => escapeCsvValue(String(cell))).join(','))
    .join('\n');
}

function downloadCsv(events: PauseHistoryEvent[]): void {
  const csv = buildCsv(events);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'pause-history.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export const PauseHistoryTable: React.FC<PauseHistoryTableProps> = ({
  events,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
  total,
  sort = { field: 'timestamp', direction: 'desc' },
  onPageChange,
  onSortChange,
  onExportCsv,
}) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const sortedEvents = useMemo(() => {
    const copy = [...events];
    copy.sort((a, b) => compareEvents(a, b, sort));
    return copy;
  }, [events, sort]);

  const totalCount = total ?? sortedEvents.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageEvents = sortedEvents.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const handleSort = (field: PauseHistorySortField) => {
    if (!onSortChange) return;
    const direction: SortDirection =
      sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ field, direction });
  };

  const handleExport = () => {
    if (onExportCsv) {
      onExportCsv(sortedEvents);
    } else {
      downloadCsv(sortedEvents);
    }
  };

  const sortIndicator = (field: PauseHistorySortField) => {
    if (sort.field !== field) return '';
    return sort.direction === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="pause-history-table">
      <div className="pause-history-table__toolbar">
        <button type="button" onClick={handleExport}>
          Export to CSV
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>
              <button type="button" onClick={() => handleSort('action')}>
                Action{sortIndicator('action')}
              </button>
            </th>
            <th>
              <button type="button" onClick={() => handleSort('adminName')}>
                Admin{sortIndicator('adminName')}
              </button>
            </th>
            <th>
              <button type="button" onClick={() => handleSort('timestamp')}>
                Timestamp{sortIndicator('timestamp')}
              </button>
            </th>
            <th>Duration</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {pageEvents.length === 0 ? (
            <tr>
              <td colSpan={5}>No pause history events.</td>
            </tr>
          ) : (
            pageEvents.map((event) => {
              const isExpanded = expandedId === event.id;
              return (
                <React.Fragment key={event.id}>
                  <tr
                    className="pause-history-table__row"
                    onClick={() => setExpandedId(isExpanded ? null : event.id)}
                  >
                    <td>{event.action}</td>
                    <td>{event.adminName}</td>
                    <td>{formatTimestamp(event.timestamp)}</td>
                    <td>{formatDuration(event.durationMs)}</td>
                    <td>{event.reason ?? '—'}</td>
                  </tr>
                  {isExpanded && (
                    <tr className="pause-history-table__details">
                      <td colSpan={5}>
                        <dl>
                          <dt>Event ID</dt>
                          <dd>{event.id}</dd>
                          <dt>Admin ID</dt>
                          <dd>{event.adminId ?? '—'}</dd>
                          <dt>Full reason</dt>
                          <dd>{event.reason ?? '—'}</dd>
                          {event.details && (
                            <>
                              <dt>Details</dt>
                              <dd>
                                <pre>{JSON.stringify(event.details, null, 2)}</pre>
                              </dd>
                            </>
                          )}
                        </dl>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })
          )}
        </tbody>
      </table>
      <div className="pause-history-table__pagination">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => onPageChange?.(currentPage - 1)}
        >
          Previous
        </button>
        <span>
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange?.(currentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
};

export default PauseHistoryTable;
