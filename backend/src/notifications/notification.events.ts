/**
 * Verifier push-notification contract.
 *
 * The same string constants are used as EventEmitter2 event names *and* as the
 * Socket.io event names delivered to clients, so the frontend hook and the
 * backend emitters cannot drift apart.
 */

export const VERIFIER_EVENTS = {
  PROJECT_PENDING_VERIFICATION: 'project.pending_verification',
  PROJECT_VERIFICATION_DEADLINE_24H: 'project.verification_deadline_24h',
  ORACLE_MONITORING_STALE: 'oracle.monitoring_stale',
} as const;

export type VerifierEventName =
  (typeof VERIFIER_EVENTS)[keyof typeof VERIFIER_EVENTS];

/** Every payload carries the verifier it is destined for — that address is the room key. */
interface VerifierScopedEvent {
  /** Stellar address of the assigned verifier. Determines Socket.io room. */
  verifierAddress: string;
  /** ISO-8601 emission time, so a reconnecting client can order/dedupe. */
  emittedAt: string;
}

export interface ProjectPendingVerificationEvent extends VerifierScopedEvent {
  projectId: string;
  name: string;
  methodology: string;
  country: string;
  vintageYear: number;
}

export interface ProjectVerificationDeadlineEvent extends VerifierScopedEvent {
  projectId: string;
  name: string;
  /** When the project entered Pending — the deadline is this + SLA. */
  pendingSince: string;
  hoursRemaining: number;
}

export interface OracleMonitoringStaleEvent extends VerifierScopedEvent {
  projectId: string;
  name: string;
  /** Last monitoring submission, or null if the project has never reported. */
  lastMonitoringAt: string | null;
  daysSinceLastMonitoring: number | null;
}

export type VerifierEventPayload =
  | ProjectPendingVerificationEvent
  | ProjectVerificationDeadlineEvent
  | OracleMonitoringStaleEvent;

/** Maps each event name to its payload type for type-safe emit/handle. */
export interface VerifierEventMap {
  [VERIFIER_EVENTS.PROJECT_PENDING_VERIFICATION]: ProjectPendingVerificationEvent;
  [VERIFIER_EVENTS.PROJECT_VERIFICATION_DEADLINE_24H]: ProjectVerificationDeadlineEvent;
  [VERIFIER_EVENTS.ORACLE_MONITORING_STALE]: OracleMonitoringStaleEvent;
}
