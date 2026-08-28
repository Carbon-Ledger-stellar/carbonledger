export const QUEUE_NAME = 'carbonledger';
export const WEBHOOK_QUEUE_NAME = 'carbonledger-webhooks';
export const OUTBOUND_WEBHOOK_QUEUE = 'carbonledger-outbound-webhooks';

export const JobType = {
  CERTIFICATE_GENERATION: 'certificate_generation',
  IPFS_PINNING:           'ipfs_pinning',
  ORACLE_SUBMISSION:      'oracle_submission',
  EMAIL_NOTIFICATION:     'email_notification',
  HORIZON_EVENT:          'horizon_event',
  BULK_RETIREMENT:        'bulk_retirement',
  BULK_MINT:              'bulk_mint',
} as const;

export type JobType = typeof JobType[keyof typeof JobType];
