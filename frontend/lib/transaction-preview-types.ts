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
}
