export const QUEUE_NAME = 'carbonledger';
export const WEBHOOK_QUEUE_NAME = 'carbonledger-webhooks';

export const JobType = {
  CERTIFICATE_GENERATION: 'certificate_generation',
  IPFS_PINNING:           'ipfs_pinning',
  ORACLE_SUBMISSION:      'oracle_submission',
  EMAIL_NOTIFICATION:     'email_notification',
  HORIZON_EVENT:          'horizon_event',
} as const;

export type JobType = typeof JobType[keyof typeof JobType];
