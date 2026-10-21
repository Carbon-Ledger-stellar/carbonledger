import React, { useEffect, useRef } from 'react';

export interface PauseConfirmModalProps {
  /** Whether the modal is currently visible. */
  isOpen: boolean;
  /** Title displayed at the top of the modal. */
  title?: string;
  /** Descriptive message shown below the title. */
  message?: string;
  /** Label for the confirm action button. */
  confirmLabel?: string;
  /** Label for the cancel action button. */
  cancelLabel?: string;
  /** Called when the user confirms the pause action. */
  onConfirm: () => void;
  /** Called when the user cancels or dismisses the modal. */
  onCancel: () => void;
  /** Optional additional class names for the modal container. */
  className?: string;
}

/**
 * PauseConfirmModal
 *
 * Reusable confirmation dialog for pause-related actions. Renders nothing
 * when `isOpen` is false. Supports Escape-to-cancel and backdrop dismissal.
 */
export const PauseConfirmModal: React.FC<PauseConfirmModalProps> = ({
  isOpen,
  title = 'Pause session?',
  message = 'Are you sure you want to pause? You can resume at any time.',
  confirmLabel = 'Pause',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  className,
}) => {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    confirmRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className={['pause-confirm-modal__backdrop', className]
        .filter(Boolean)
        .join(' ')}
      role="presentation"
      onClick={onCancel}
    >
      <div
        className="pause-confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-confirm-modal-title"
        aria-describedby="pause-confirm-modal-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="pause-confirm-modal-title" className="pause-confirm-modal__title">
          {title}
        </h2>
        <p id="pause-confirm-modal-message" className="pause-confirm-modal__message">
          {message}
        </p>
        <div className="pause-confirm-modal__actions">
          <button
            type="button"
            className="pause-confirm-modal__button pause-confirm-modal__button--cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="pause-confirm-modal__button pause-confirm-modal__button--confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PauseConfirmModal;
