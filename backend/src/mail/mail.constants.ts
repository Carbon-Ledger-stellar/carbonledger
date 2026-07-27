export const MAIL_QUEUE = 'mail_queue';

export enum MailEvent {
  PROJECT_APPROVED    = 'PROJECT_APPROVED',
  CREDITS_MINTED      = 'CREDITS_MINTED',
  PURCHASE_CONFIRMED  = 'PURCHASE_CONFIRMED',
  RETIREMENT_CONFIRMED = 'RETIREMENT_CONFIRMED',
}

export const EMAIL_TEMPLATES = {
  [MailEvent.PROJECT_APPROVED]:    'project-approved',
  [MailEvent.CREDITS_MINTED]:      'credits-minted',
  [MailEvent.PURCHASE_CONFIRMED]:  'purchase-confirmed',
  [MailEvent.RETIREMENT_CONFIRMED]: 'retirement-confirmed',
};
