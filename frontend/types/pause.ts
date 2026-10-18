// Pause-related shared types

export type PauseStatus = 'active' | 'paused' | 'resumed' | 'expired';

export interface PauseReason {
  id: string;
  label: string;
  description?: string;
  category?: string;
}

export interface PauseAdmin {
  id: string;
  name: string;
  avatarUrl?: string;
  role?: string;
}

export interface PauseEvent {
  id: string;
  /** ISO timestamp when the pause began */
  startedAt: string;
  /** ISO timestamp when the pause ended/resumed; null while still paused */
  endedAt?: string | null;
  reason: PauseReason | string;
  admin: PauseAdmin;
  status?: PauseStatus;
  notes?: string;
}

/**
 * Duration in milliseconds for a pause event.
 * Falls back to "now" for events that are still active.
 */
export function getPauseDurationMs(
  event: Pick<PauseEvent, 'startedAt' | 'endedAt'>,
  now: number = Date.now(),
): number {
  const start = new Date(event.startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = event.endedAt ? new Date(event.endedAt).getTime() : now;
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

/**
 * Human-readable duration, e.g. "2h 15m", "45s", "3d 4h".
 */
export function formatPauseDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
