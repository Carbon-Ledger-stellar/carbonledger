import { useCallback, useState } from 'react';
import { usePauseStatus } from './usePauseStatus';

export interface PauseConfirmationState {
  isOpen: boolean;
  action: 'pause' | 'unpause' | null;
  step: 1 | 2;
}

export interface PauseConfirmationModalProps {
  isOpen: boolean;
  action: 'pause' | 'unpause' | null;
  step: 1 | 2;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface UsePauseResult {
  isPaused: boolean;
  isLoading: boolean;
  error: string | null;
  confirmation: PauseConfirmationState;
  requestPause: () => void;
  requestUnpause: () => void;
  confirm: () => void;
  cancel: () => void;
}

const INITIAL_CONFIRMATION: PauseConfirmationState = {
  isOpen: false,
  action: null,
  step: 1,
};

/**
 * Hook that manages pause/unpause actions together with the double-confirmation
 * flow required before the action is executed.
 */
export function usePause(): UsePauseResult {
  const { isPaused, isLoading, error, pause, unpause } = usePauseStatus();
  const [confirmation, setConfirmation] = useState<PauseConfirmationState>(INITIAL_CONFIRMATION);

  const requestPause = useCallback(() => {
    setConfirmation({ isOpen: true, action: 'pause', step: 1 });
  }, []);

  const requestUnpause = useCallback(() => {
    setConfirmation({ isOpen: true, action: 'unpause', step: 1 });
  }, []);

  const cancel = useCallback(() => {
    setConfirmation(INITIAL_CONFIRMATION);
  }, []);

  const confirm = useCallback(() => {
    setConfirmation((current) => {
      if (!current.isOpen || !current.action) {
        return current;
      }

      // First confirmation advances to the second step; the second confirmation
      // actually executes the pause/unpause action.
      if (current.step === 1) {
        return { ...current, step: 2 };
      }

      if (current.action === 'pause') {
        void pause();
      } else {
        void unpause();
      }

      return INITIAL_CONFIRMATION;
    });
  }, [pause, unpause]);

  return {
    isPaused,
    isLoading,
    error,
    confirmation,
    requestPause,
    requestUnpause,
    confirm,
    cancel,
  };
}
