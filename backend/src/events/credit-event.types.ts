/**
 * All event types that can mutate a CreditBatch's state.
 * Covers all 6 lifecycle transitions:
 *  1. MINT     ('mint' / 'minted')
 *  2. VERIFY   ('verify' / 'verified')
 *  3. LIST     ('list' / 'listed')
 *  4. DELIST   ('delist' / 'delisted')
 *  5. PURCHASE ('purchase' / 'transfer')
 *  6. RETIRE   ('retire' / 'retired')
 */
export const CreditEventType = {
  MINT:     'mint',
  VERIFY:   'verify',
  LIST:     'list',
  DELIST:   'delist',
  PURCHASE: 'purchase',
  TRANSFER: 'transfer',
  RETIRE:   'retire',
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

/**
 * Derived read-model projection shape for a CreditBatch.
 */
export interface CreditProjectionRecord {
  id:              string;
  creditBatchId:   string;
  projectId:       string;
  ownerPublicKey:  string;
  status:          string;
  amountAvailable: number;
  amountRetired:   number;
  pricePerCredit:  string | null;
  txHash:          string | null;
  lastEventType:   string;
  version:         number;
  updatedAt:       Date;
  createdAt:       Date;
}
