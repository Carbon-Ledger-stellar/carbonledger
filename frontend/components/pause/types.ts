export type PauseStatus = 'operational' | 'paused' | 'expiring_soon' | 'loading';

export interface PauseState {
  isPaused: boolean;
  pausedUntil?: number; // Unix timestamp in seconds
  pausedAt?: number;    // Unix timestamp in seconds
  pausedBy?: string;    // Stellar admin address
  reason?: string;
  affectedContracts?: string[];
}

export interface PauseStatusIndicatorProps {
  status: PauseStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  pausedUntil?: number;
  className?: string;
}

export interface PauseButtonProps {
  isPaused: boolean;
  onInitiateAction: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export interface PauseBannerProps {
  isPaused: boolean;
  reason?: string;
  pausedUntil?: number;
  pausedBy?: string;
  onDismiss?: () => void;
  isDismissible?: boolean;
  onViewDetails?: () => void;
  className?: string;
}

export interface PauseConfirmModalProps {
  isOpen: boolean;
  action: 'pause' | 'unpause';
  onConfirm: (durationHours: number, reason: string) => Promise<void> | void;
  onCancel: () => void;
  isLoading?: boolean;
  currentStatus?: PauseState;
}
