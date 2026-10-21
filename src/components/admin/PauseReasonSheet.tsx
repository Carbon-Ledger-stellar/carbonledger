import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Mobile-responsive bottom sheet for entering a pause reason.
 *
 * Designed for phones/tablets:
 * - Slides up from the bottom of the viewport (bottom sheet pattern).
 * - Touch-friendly controls with a minimum ~44px tap target.
 * - Safe-area aware so it clears iOS home indicators and Android nav bars.
 * - Dismissible via backdrop tap, close button, or Escape key.
 */

export interface PauseReasonSheetProps {
  /** Whether the sheet is currently visible. */
  open: boolean;
  /** Called when the user dismisses the sheet without confirming. */
  onClose: () => void;
  /** Called with the selected/entered reason when the user confirms. */
  onConfirm: (reason: string) => void;
  /** Optional list of quick-pick reasons shown as touch chips. */
  quickReasons?: string[];
  /** Optional title override. */
  title?: string;
  /** Disables the confirm action (e.g. while a request is in flight). */
  submitting?: boolean;
}

const DEFAULT_QUICK_REASONS = [
  'Maintenance',
  'Investigating incident',
  'Deploying update',
  'Cost control',
];

export const PauseReasonSheet: React.FC<PauseReasonSheetProps> = ({
  open,
  onClose,
  onConfirm,
  quickReasons = DEFAULT_QUICK_REASONS,
  title = 'Pause reason',
  submitting = false,
}) => {
  const [reason, setReason] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset the field each time the sheet opens so stale text never leaks in.
  useEffect(() => {
    if (open) {
      setReason('');
      // Focus after the open transition so mobile keyboards don't fight the animation.
      const id = window.setTimeout(() => inputRef.current?.focus(), 250);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [open]);

  // Escape-to-dismiss for hardware keyboards / tablets with keyboards attached.
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleConfirm = useCallback(() => {
    const trimmed = reason.trim();
    if (!trimmed || submitting) return;
    onConfirm(trimmed);
  }, [reason, submitting, onConfirm]);

  if (!open) return null;

  const canConfirm = reason.trim().length > 0 && !submitting;

  return (
    <div
      className="pause-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={styles.root}
    >
      {/* Backdrop: large tap target to dismiss on mobile. */}
      <button
        type="button"
        aria-label="Dismiss pause reason sheet"
        onClick={onClose}
        style={styles.backdrop}
      />

      <div style={styles.sheet}>
        <div style={styles.grabber} aria-hidden="true" />

        <header style={styles.header}>
          <h2 style={styles.title}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={styles.closeButton}
          >
            ✕
          </button>
        </header>

        <div style={styles.quickRow} role="group" aria-label="Quick reasons">
          {quickReasons.map((quick) => {
            const selected = reason === quick;
            return (
              <button
                key={quick}
                type="button"
                onClick={() => setReason(quick)}
                aria-pressed={selected}
                style={{
                  ...styles.chip,
                  ...(selected ? styles.chipSelected : null),
                }}
              >
                {quick}
              </button>
            );
          })}
        </div>

        <label htmlFor="pause-reason-input" style={styles.label}>
          Reason
        </label>
        <textarea
          id="pause-reason-input"
          ref={inputRef}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why are you pausing?"
          rows={3}
          maxLength={280}
          style={styles.textarea}
        />

        <div style={styles.actions}>
          <button
            type="button"
            onClick={onClose}
            style={styles.secondaryButton}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            style={{
              ...styles.primaryButton,
              ...(canConfirm ? null : styles.primaryButtonDisabled),
            }}
          >
            {submitting ? 'Pausing…' : 'Pause'}
          </button>
        </div>
      </div>
    </div>
  );
};

// Inline styles keep this component dependency-free and easy to port into the
// existing design system. All interactive targets are >= 44px tall.
const MIN_TAP = 44;

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  backdrop: {
    position: 'absolute',
    inset: 0,
    border: 'none',
    padding: 0,
    margin: 0,
    background: 'rgba(0, 0, 0, 0.45)',
    cursor: 'pointer',
  },
  sheet: {
    position: 'relative',
    width: '100%',
    maxWidth: 560,
    background: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: '12px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
    boxShadow: '0 -8px 32px rgba(0, 0, 0, 0.18)',
    boxSizing: 'border-box',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    background: '#d0d5dd',
    margin: '0 auto 12px',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
    color: '#101828',
  },
  closeButton: {
    minWidth: MIN_TAP,
    minHeight: MIN_TAP,
    border: 'none',
    background: 'transparent',
    fontSize: 18,
    color: '#475467',
    cursor: 'pointer',
    borderRadius: 8,
  },
  quickRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  chip: {
    minHeight: MIN_TAP,
    padding: '0 16px',
    borderRadius: 22,
    border: '1px solid #d0d5dd',
    background: '#f9fafb',
    color: '#344054',
    fontSize: 14,
    cursor: 'pointer',
  },
  chipSelected: {
    background: '#eff4ff',
    borderColor: '#2e6ff2',
    color: '#1d4ed8',
  },
  label: {
    display: 'block',
    fontSize: 13,
    fontWeight: 500,
    color: '#475467',
    marginBottom: 6,
  },
  textarea: {
    width: '100%',
    minHeight: 88,
    padding: 12,
    borderRadius: 12,
    border: '1px solid #d0d5dd',
    fontSize: 16, // >=16px prevents iOS Safari auto-zoom on focus.
    lineHeight: 1.4,
    resize: 'vertical',
    boxSizing: 'border-box',
    color: '#101828',
  },
  actions: {
    display: 'flex',
    gap: 12,
    marginTop: 20,
  },
  secondaryButton: {
    flex: 1,
    minHeight: MIN_TAP,
    borderRadius: 12,
    border: '1px solid #d0d5dd',
    background: '#ffffff',
    color: '#344054',
    fontSize: 16,
    fontWeight: 500,
    cursor: 'pointer',
  },
  primaryButton: {
    flex: 1,
    minHeight: MIN_TAP,
    borderRadius: 12,
    border: 'none',
    background: '#2e6ff2',
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
  },
  primaryButtonDisabled: {
    background: '#b2c7f5',
    cursor: 'not-allowed',
  },
};

export default PauseReasonSheet;
