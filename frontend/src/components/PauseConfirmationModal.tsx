import { useState } from 'react';

interface PauseConfirmationModalProps {
  isOpen: boolean;
  action: 'pause' | 'unpause';
  onConfirm: () => void;
  onCancel: () => void;
  isSubmitting?: boolean;
}

const BLOCKED_OPERATIONS = ['Mint', 'Transfer', 'Retire'];
const CONTINUING_OPERATIONS = ['Queries', 'Reads'];

export default function PauseConfirmationModal({
  isOpen,
  action,
  onConfirm,
  onCancel,
  isSubmitting = false,
}: PauseConfirmationModalProps) {
  const [firstConfirmed, setFirstConfirmed] = useState(false);
  const [secondConfirmed, setSecondConfirmed] = useState(false);

  if (!isOpen) {
    return null;
  }

  const isPausing = action === 'pause';
  const canConfirm = firstConfirmed && secondConfirmed && !isSubmitting;

  const handleCancel = () => {
    setFirstConfirmed(false);
    setSecondConfirmed(false);
    onCancel();
  };

  const handleConfirm = () => {
    if (!canConfirm) {
      return;
    }
    setFirstConfirmed(false);
    setSecondConfirmed(false);
    onConfirm();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pause-confirmation-title">
      <div className="modal-content">
        <h2 id="pause-confirmation-title">
          {isPausing ? 'Confirm Pause' : 'Confirm Unpause'}
        </h2>

        <p className="modal-warning">
          {isPausing
            ? 'Pausing the contract will halt all state-changing operations. This action affects every user of the protocol.'
            : 'Unpausing the contract will resume all state-changing operations. Make sure the underlying issue has been resolved before continuing.'}
        </p>

        <div className="modal-section">
          <h3>Operations that will be blocked</h3>
          <ul className="modal-list modal-list-blocked">
            {BLOCKED_OPERATIONS.map((operation) => (
              <li key={operation}>{operation}</li>
            ))}
          </ul>
        </div>

        <div className="modal-section">
          <h3>Operations that will continue to work</h3>
          <ul className="modal-list modal-list-allowed">
            {CONTINUING_OPERATIONS.map((operation) => (
              <li key={operation}>{operation}</li>
            ))}
          </ul>
        </div>

        <div className="modal-confirmations">
          <label className="modal-checkbox">
            <input
              type="checkbox"
              checked={firstConfirmed}
              onChange={(event) => setFirstConfirmed(event.target.checked)}
            />
            <span>
              Yes, I understand the impact of {isPausing ? 'pausing' : 'unpausing'} the contract.
            </span>
          </label>

          <label className="modal-checkbox">
            <input
              type="checkbox"
              checked={secondConfirmed}
              onChange={(event) => setSecondConfirmed(event.target.checked)}
            />
            <span>
              Yes, I confirm I want to {isPausing ? 'pause' : 'unpause'} the contract.
            </span>
          </label>
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {isSubmitting ? 'Submitting...' : isPausing ? 'Pause' : 'Unpause'}
          </button>
        </div>
      </div>
    </div>
  );
}
