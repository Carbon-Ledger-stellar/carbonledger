export type PauseContract = 'credit' | 'marketplace';
export type PauseAction = 'pause' | 'unpause';

export const PAUSE_CONTRACTS: PauseContract[] = ['credit', 'marketplace'];
export const PAUSE_ACTIONS: PauseAction[] = ['pause', 'unpause'];

/** Reason bucket used when a pause has no admin-supplied reason yet. */
export const UNSPECIFIED_REASON = 'unspecified';

/** Row shape of the `pause_events` table. */
export interface PauseEventRecord {
  id: string;
  contract: string;
  action: string;
  admin: string;
  reason: string | null;
  pausedUntil: Date | null;
  txHash: string;
  eventId: string | null;
  occurredAt: Date;
}

/** An on-chain `(c_ledger, paused|unpaused)` event, decoded by the indexer. */
export interface ChainPauseEvent {
  contract: PauseContract;
  action: PauseAction;
  admin: string;
  txHash: string;
  eventId?: string;
  occurredAt: Date;
  pausedUntil?: Date | null;
}

/**
 * How a pause period ended:
 *  - manual:  an admin called unpause_operations
 *  - expired: the pause window elapsed (contract auto-unpauses lazily)
 *  - renewed: a new pause_operations call replaced the window
 *  - ongoing: still paused at report time
 */
export type PauseEnding = 'manual' | 'expired' | 'renewed' | 'ongoing';

export interface PausePeriod {
  contract: string;
  admin: string;
  reason: string;
  txHash: string;
  startedAt: string;
  endedAt: string;
  requestedSeconds: number | null;
  durationSeconds: number;
  endedBy: PauseEnding;
}

export interface PauseAnalyticsQuery {
  from: Date;
  to: Date;
  contract?: PauseContract;
}

export interface PauseSummary {
  window: { from: string; to: string; contract: PauseContract | 'all' };
  totals: { pauses: number; unpauses: number };
  byContract: Record<string, { pauses: number; unpauses: number }>;
  /** Pauses per UTC day, only days with at least one pause. */
  frequency: Array<{ date: string; pauses: number }>;
  durations: {
    count: number;
    meanSeconds: number;
    medianSeconds: number;
    maxSeconds: number;
    totalSeconds: number;
    byEnding: Record<PauseEnding, number>;
  };
  reasons: Array<{ reason: string; count: number }>;
  admins: Array<{ admin: string; pauses: number; unpauses: number }>;
  periods: PausePeriod[];
}
