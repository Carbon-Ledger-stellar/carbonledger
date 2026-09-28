export type PauseAlertKind = 'pause' | 'unpause' | 'error';

export type PauseAlertSeverity = 'info' | 'warning' | 'error';

export interface PauseAlert {
  id: string;
  kind: PauseAlertKind;
  severity: PauseAlertSeverity;
  title: string;
  message: string;
  /** ISO timestamp of when the alert was emitted. */
  timestamp: string;
  /** Optional contract/account the alert relates to. */
  contractId?: string;
  /** Optional transaction hash for pause/unpause events. */
  txHash?: string;
  /** Optional error code for pause-triggered errors. */
  errorCode?: string;
  /** Optional stack trace or extra diagnostic detail. */
  details?: string;
  read: boolean;
}

export interface PauseAlertsState {
  alerts: PauseAlert[];
  unreadCount: number;
}

export type PauseAlertFilter = 'all' | 'unread' | PauseAlertKind;
