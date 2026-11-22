export interface PreviewEffect {
  label: string;
  value: string;
  detail?: string;
}

/**
 * Itemized fee breakdown shown in TransactionPreview (#1511).
 * All three fields are optional — omitted fields are not rendered.
 */
export interface FeeBreakdown {
  /** Credits subtotal before any fees (e.g. "42.50 USDC"). */
  subtotal?: string;
  /** CarbonLedger platform fee charged on top of the credit price (e.g. "0.43 USDC"). */
  platformFee?: string;
  /** Stellar network base fee for the transaction (e.g. "0.000100 XLM"). */
  networkFee?: string;
  /** Grand total the user will pay, pre-computed by the caller (e.g. "42.93 USDC + 0.000100 XLM"). */
  total?: string;
}

export interface PreviewState {
  loading: boolean;
  ready: boolean;
  error?: string;
  effects: PreviewEffect[];
  /** Deprecated single-field fee string; prefer feeBreakdown for new callers. */
  feeEstimate?: string;
  /** Pre-fee subtotal amount, e.g. "49.00 USDC". When provided, the full fee breakdown section is shown. */
  subtotal?: string;
  /** Platform fee amount, e.g. "0.49 USDC" (1% protocol fee). */
  platformFee?: string;
  /** Grand total including all fees, e.g. "49.57 USDC". */
  totalAmount?: string;
}
