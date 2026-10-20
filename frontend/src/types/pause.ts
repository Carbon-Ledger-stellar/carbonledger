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

export interface PauseConfirmationModalProps {
  isOpen: boolean;
  action: PauseAction;
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

export interface PauseImpact {
  blockedOperations: string[];
  continuedOperations: string[];
}

export const PAUSE_IMPACT: PauseImpact = {
  blockedOperations: ['Mint', 'Transfer', 'Retire'],
  continuedOperations: ['Queries', 'Reads'],
};

export interface PauseReasonPreset {
  id: string;
  label: string;
  description?: string;
}

export const PAUSE_REASON_PRESETS: PauseReasonPreset[] = [
  {
    id: 'maintenance',
    label: 'Scheduled maintenance',
    description: 'Planned downtime for upgrades or upkeep.',
  },
  {
    id: 'security',
    label: 'Security concern',
    description: 'Suspicious activity or a potential vulnerability.',
  },
  {
    id: 'incident',
    label: 'Active incident',
    description: 'Responding to an ongoing operational incident.',
  },
  {
    id: 'compliance',
    label: 'Compliance / legal hold',
    description: 'Required by a regulatory or legal request.',
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Provide a custom reason below.',
  },
];

export const PAUSE_REASON_CUSTOM_ID = 'other';

export const PAUSE_REASON_MAX_LENGTH = 280;

export const PAUSE_REASON_HELP_TEXT =
  'Select a preset reason or choose "Other" to enter a custom reason. The reason is recorded in the pause history for audit purposes.';

export interface PauseReasonSelection {
  presetId: string;
  customReason: string;
}

export function isCustomPauseReason(presetId: string): boolean {
  return presetId === PAUSE_REASON_CUSTOM_ID;
}

export function getPauseReasonCharacterCount(value: string): number {
  return value.length;
}

export function isPauseReasonWithinLimit(value: string): boolean {
  return value.length <= PAUSE_REASON_MAX_LENGTH;
}

export function resolvePauseReason(selection: PauseReasonSelection): string {
  if (isCustomPauseReason(selection.presetId)) {
    return selection.customReason.trim();
  }
  const preset = PAUSE_REASON_PRESETS.find((p) => p.id === selection.presetId);
  return preset ? preset.label : selection.customReason.trim();
}
