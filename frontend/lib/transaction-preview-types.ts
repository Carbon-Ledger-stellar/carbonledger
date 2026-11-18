export interface PreviewEffect {
  label: string;
  value: string;
  detail?: string;
}

export interface PreviewState {
  loading: boolean;
  ready: boolean;
  error?: string;
  effects: PreviewEffect[];
  feeEstimate?: string;
  /** Pre-fee subtotal amount, e.g. "49.00 USDC". When provided, the full fee breakdown section is shown. */
  subtotal?: string;
  /** Platform fee amount, e.g. "0.49 USDC" (1% protocol fee). */
  platformFee?: string;
  /** Grand total including all fees, e.g. "49.57 USDC". */
  totalAmount?: string;
}
