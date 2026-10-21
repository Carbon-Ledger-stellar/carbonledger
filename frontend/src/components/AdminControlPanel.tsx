import { useState } from 'react';
import { pauseContract, unpauseContract } from '../services/api';

interface AdminControlPanelProps {
  isAdmin: boolean;
}

type PendingAction = 'pause' | 'unpause' | null;

export default function AdminControlPanel({ isAdmin }: AdminControlPanelProps) {
  const [reason, setReason] = useState('');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const requestAction = (action: Exclude<PendingAction, null>) => {
    setSuccessMessage('');
    setErrorMessage('');
    setPendingAction(action);
  };

  const confirmAction = async () => {
    if (!pendingAction) return;
    setLoading(true);
    setErrorMessage('');
    try {
      if (pendingAction === 'pause') {
        await pauseContract(reason.trim() || undefined);
        setSuccessMessage('Contract paused successfully.');
      } else {
        await unpauseContract();
        setSuccessMessage('Contract unpaused successfully.');
      }
      setReason('');
    } catch (err) {
      const message =
        err instanceof Error && err.message
          ? err.message
          : 'Something went wrong. Please try again.';
      setErrorMessage(message);
    } finally {
      setLoading(false);
      setPendingAction(null);
    }
  };

  const cancelAction = () => {
    setPendingAction(null);
  };

  return (
    <div className="admin-control-panel">
      <h2>Pause Control</h2>

      <div className="pause-reason-field">
        <label htmlFor="pause-reason">Pause reason (optional)</label>
        <input
          id="pause-reason"
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for pausing the contract"
          disabled={!isAdmin || loading}
        />
      </div>

      <div className="pause-actions">
        <button
          type="button"
          onClick={() => requestAction('pause')}
          disabled={!isAdmin || loading}
        >
          Pause Contract
        </button>
        <button
          type="button"
          onClick={() => requestAction('unpause')}
          disabled={!isAdmin || loading}
        >
          Unpause Contract
        </button>
      </div>

      {!isAdmin && (
        <p className="admin-warning">
          You need an admin role to pause or unpause the contract.
        </p>
      )}

      {successMessage && <p className="success-message">{successMessage}</p>}
      {errorMessage && <p className="error-message">{errorMessage}</p>}

      {pendingAction && (
        <div className="confirmation-dialog" role="dialog" aria-modal="true">
          <p>
            {pendingAction === 'pause'
              ? 'Are you sure you want to pause the contract?'
              : 'Are you sure you want to unpause the contract?'}
          </p>
          <div className="confirmation-actions">
            <button type="button" onClick={confirmAction} disabled={loading}>
              {loading ? 'Processing...' : 'Confirm'}
            </button>
            <button type="button" onClick={cancelAction} disabled={loading}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
