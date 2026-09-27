export type PauseAction = 'pause' | 'unpause';

export interface PauseHistoryEvent {
  id: string;
  action: PauseAction;
  adminName: string;
  adminId?: string;
  timestamp: string;
  reason?: string;
  durationMs?: number;
  details?: Record<string, unknown>;
}

export type PauseHistorySortField = 'timestamp' | 'adminName' | 'action';

export type SortDirection = 'asc' | 'desc';

export interface PauseHistorySort {
  field: PauseHistorySortField;
  direction: SortDirection;
}

export interface PauseHistoryPagination {
  page: number;
  pageSize: number;
  total: number;
}

export interface PauseHistoryQuery {
  page?: number;
  pageSize?: number;
  sortField?: PauseHistorySortField;
  sortDirection?: SortDirection;
}

export interface PauseHistoryResponse {
  events: PauseHistoryEvent[];
  pagination: PauseHistoryPagination;
}
