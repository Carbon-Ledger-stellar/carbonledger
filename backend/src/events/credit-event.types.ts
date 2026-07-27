/**
 * All event types that can mutate a CreditBatch's state.
 * Used as the `eventType` discriminant in the event log.
 */
export const CreditEventType = {
  MINT:     'mint',
  TRANSFER: 'transfer',
  RETIRE:   'retire',
  LIST:     'list',
  DELIST:   'delist',
} as const;

export type CreditEventType = (typeof CreditEventType)[keyof typeof CreditEventType];

/**
 * Shape of a persisted credit event row (mirrors the Prisma model).
 */
export interface CreditEventRecord {
  id:            string;
  creditBatchId: string;
  eventType:     CreditEventType;
  actor:         string;
  oldState:      Record<string, unknown> | null;
  newState:      Record<string, unknown> | null;
  timestamp:     Date;
  txHash:        string;
  signature:     string;
}

/**
 * Input needed to record a new event.
 */
export interface RecordEventInput {
  creditBatchId: string;
  eventType:     CreditEventType;
  actor:         string;
  oldState?:     Record<string, unknown> | null;
  newState?:     Record<string, unknown> | null;
  txHash:        string;
}
