/** Analytics event names tracked across CarbonLedger. */
export enum AnalyticsEvent {
  // User lifecycle
  USER_SIGNED_UP           = 'user_signed_up',
  USER_LOGGED_IN           = 'user_logged_in',

  // Marketplace
  PAGE_VIEWED              = 'page_viewed',
  LISTING_VIEWED           = 'listing_viewed',
  MARKETPLACE_SEARCHED     = 'marketplace_searched',

  // Purchase flow
  PURCHASE_INITIATED       = 'purchase_initiated',
  PURCHASE_COMPLETED       = 'purchase_completed',
  BULK_PURCHASE_COMPLETED  = 'bulk_purchase_completed',

  // Retirement flow
  RETIREMENT_INITIATED     = 'retirement_initiated',
  RETIREMENT_COMPLETED     = 'retirement_completed',
  CERTIFICATE_DOWNLOADED   = 'certificate_downloaded',

  // Verification
  PROJECT_VERIFIED         = 'project_verified',
  SERIAL_NUMBER_LOOKED_UP  = 'serial_number_looked_up',

  // Errors & performance
  ERROR_OCCURRED           = 'error_occurred',
}

/** Properties attached to every event (set via `identify`). */
export interface UserTraits {
  publicKey?: string;
  role?: string;
  createdAt?: Date | string;
}
