export interface Contract {
  id: string;
  name: string;
  address: string;
  network: string;
  createdAt: string;
  updatedAt: string;
  isPaused: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
  pauseReason: string | null;
}

export interface ContractPauseStatus {
  isPaused: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
  pauseReason: string | null;
}
