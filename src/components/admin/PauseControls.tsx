import React, { useState } from 'react';

/**
 * Mobile-responsive pause controls for the admin dashboard.
 *
 * Design goals (issue #1178):
 * - Mobile layout for pause controls (stacked, full-width on phones/tablets)
 * - Touch-friendly button sizes (min 44px tap targets)
 * - Bottom sheet design for entering the pause reason
 * - Mobile notification / status display for the pause state
 */

export interface PauseControlsProps {
  /** Whether the system is currently paused. */
  isPaused: boolean;
  /** Current pause reason, if any. */
  pauseReason?: string;
  /** Called when the admin confirms a pause with a reason. */
  onPause?: (reason: string) => void;
  /** Called when the admin resumes the system. */
  onResume?: () => void;
  /** Disables interaction while a request is in flight. */
  isSubmitting?: boolean;
}

const MIN_TAP_TARGET = 44;

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
    boxSizing: 'border-box',
    padding: 16,
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderRadius: 12,
    fontSize: 15,
    fontWeight: 600,
    lineHeight: 1.3,
  },
  statusPaused: {
    background: '#FEF3C7',
    color: '#92400E',
    border: '1px solid #FCD34D',
  },
  statusActive: {
    background: '#DCFCE7',
    color: '#166534',
    border: '1px solid #86EFAC',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  reason: {
    fontSize: 13,
    fontWeight: 400,
    opacity: 0.85,
    marginTop: 2,
  },
  button: {
    minHeight: MIN_TAP_TARGET,
    minWidth: MIN_TAP_TARGET,
    width: '100%',
    padding: '12px 20px',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    border: 'none',
    cursor: 'pointer',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
  pauseButton: {
    background: '#DC2626',
    color: '#FFFFFF',
  },
  resumeButton: {
    background: '#16A34A',
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
    zIndex: 1000,
  },
  sheet: {
    width: '100%',
    maxWidth: 560,
    background: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: '20px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    maxHeight: '85vh',
    overflowY: 'auto',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    background: '#D1D5DB',
    alignSelf: 'center',
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#111827',
    margin: 0,
  },
  label: {
    fontSize: 14,
    fontWeight: 600,
    color: '#374151',
  },
  textarea: {
    width: '100%',
    minHeight: 96,
    padding: 12,
    borderRadius: 12,
    border: '1px solid #D1D5DB',
    fontSize: 16,
    fontFamily: 'inherit',
    resize: 'vertical',
    boxSizing: 'border-box',
  },
  sheetActions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  cancelButton: {
    minHeight: MIN_TAP_TARGET,
    width: '100%',
    padding: '12px 20px',
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    background: '#F3F4F6',
    color: '#374151',
    border: 'none',
    cursor: 'pointer',
    touchAction: 'manipulation',
  },
};

export const PauseControls: React.FC<PauseControlsProps> = ({
  isPaused,
  pauseReason,
  onPause,
  onResume,
  isSubmitting = false,
}) => {
  const [isSheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState('');

  const openSheet = () => {
    setReason('');
    setSheetOpen(true);
  };

  const closeSheet = () => setSheetOpen(false);

  const confirmPause = () => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onPause?.(trimmed);
    setSheetOpen(false);
  };

  return (
    <div style={styles.container}>
      {/* Mobile status / notification display */}
      <div
        role="status"
        aria-live="polite"
        style={{
          ...styles.status,
          ...(isPaused ? styles.statusPaused : styles.statusActive),
        }}
      >
        <span
          style={{
            ...styles.dot,
            background: isPaused ? '#D97706' : '#16A34A',
          }}
        />
        <div>
          <div>{isPaused ? 'System paused' : 'System active'}</div>
          {isPaused && pauseReason ? (
            <div style={styles.reason}>{pauseReason}</div>
          ) : null}
        </div>
      </div>

      {/* Primary action: full-width, touch-friendly */}
      {isPaused ? (
        <button
          type="button"
          onClick={onResume}
          disabled={isSubmitting}
          style={{
            ...styles.button,
            ...styles.resumeButton,
            ...(isSubmitting ? styles.disabled : null),
          }}
        >
          {isSubmitting ? 'Resuming…' : 'Resume system'}
        </button>
      ) : (
        <button
          type="button"
          onClick={openSheet}
          disabled={isSubmitting}
          style={{
            ...styles.button,
            ...styles.pauseButton,
            ...(isSubmitting ? styles.disabled : null),
          }}
        >
          Pause system
        </button>
      )}

      {/* Bottom sheet for pause reason */}
      {isSheetOpen ? (
        <div
          style={styles.overlay}
          role="dialog"
          aria-modal="true"
          aria-label="Pause reason"
          onClick={closeSheet}
        >
          <div style={styles.sheet} onClick={(e) => e.stopPropagation()}>
            <div style={styles.grabber} />
            <h2 style={styles.sheetTitle}>Pause system</h2>
            <label style={styles.label} htmlFor="pause-reason">
              Reason
            </label>
            <textarea
              id="pause-reason"
              style={styles.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you pausing the system?"
              autoFocus
            />
            <div style={styles.sheetActions}>
              <button
                type="button"
                onClick={confirmPause}
                disabled={!reason.trim() || isSubmitting}
                style={{
                  ...styles.button,
                  ...styles.pauseButton,
                  ...(!reason.trim() || isSubmitting ? styles.disabled : null),
                }}
              >
                {isSubmitting ? 'Pausing…' : 'Confirm pause'}
              </button>
              <button type="button" onClick={closeSheet} style={styles.cancelButton}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PauseControls;
