import { useState } from 'react';

interface PauseButtonProps {
  isPaused: boolean;
  onPause: () => void | Promise<void>;
  onUnpause: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Pause/unpause control that requires double confirmation before
 * changing the contract's paused state.
 */
export function PauseButton({ isPaused, onPause, onUnpause, disabled }: PauseButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [firstConfirmed, setFirstConfirmed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const action = isPaused ? 'unpause' : 'pause';

  const openModal = () => {
    setFirstConfirmed(false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setFirstConfirmed(false);
    setIsModalOpen(false);
  };

  const handleConfirm = async () => {
    if (!firstConfirmed) {
      setFirstConfirmed(true);
      return;
    }

    setIsSubmitting(true);
    try {
      if (isPaused) {
        await onUnpause();
      } else {
        await onPause();
      }
      closeModal();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={isPaused ? 'btn btn-primary' : 'btn btn-danger'}
        onClick={openModal}
        disabled={disabled}
      >
        {isPaused ? 'Unpause Contract' : 'Pause Contract'}
      </button>

      {isModalOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-modal-title">
          <div className="modal">
            <h2 id="pause-modal-title">Confirm {action}</h2>

            <p className="modal-warning">
              {isPaused
                ? 'Unpausing will re-enable all contract operations. Make sure the contract is in a safe state before continuing.'
                : 'Pausing will halt critical contract operations. This action affects all users and should only be used in an emergency.'}
            </p>

            {!isPaused && (
              <div className="modal-section">
                <h3>Operations that will be blocked</h3>
                <ul>
                  <li>Mint</li>
                  <li>Transfer</li>
                  <li>Retire</li>
                </ul>
              </div>
            )}

            <div className="modal-section">
              <h3>Operations that will continue to work</h3>
              <ul>
                <li>Queries</li>
                <li>Reads</li>
              </ul>
            </div>

            {firstConfirmed && (
              <p className="modal-warning" role="alert">
                Are you absolutely sure? This is your final confirmation.
              </p>
            )}

            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={closeModal} disabled={isSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                className={isPaused ? 'btn btn-primary' : 'btn btn-danger'}
                onClick={handleConfirm}
                disabled={isSubmitting}
              >
                {firstConfirmed ? `Yes, ${action}` : 'Yes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default PauseButton;
