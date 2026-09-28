import React, { useEffect, useRef } from 'react';

interface PauseOverlayProps {
  isPaused: boolean;
  onResume: () => void;
  onRestart?: () => void;
  onQuit?: () => void;
}

/**
 * Pause overlay UI.
 *
 * Accessibility (WCAG 2.1 AA):
 * - Text uses high-contrast colors (>= 4.5:1 against the overlay background).
 * - All controls are native buttons, reachable and operable via keyboard.
 * - The overlay is a labelled dialog that announces pause status to screen readers.
 * - Focus is moved into the dialog on open and restored on close.
 * - Visible focus indicators are provided for every interactive element.
 */
export const PauseOverlay: React.FC<PauseOverlayProps> = ({
  isPaused,
  onResume,
  onRestart,
  onQuit,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isPaused) {
      return;
    }

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    resumeRef.current?.focus();

    return () => {
      previouslyFocused.current?.focus?.();
    };
  }, [isPaused]);

  if (!isPaused) {
    return null;
  }

  return (
    <div
      className="pause-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-overlay-title"
      aria-describedby="pause-overlay-status"
      ref={dialogRef}
    >
      <div className="pause-overlay__panel">
        <h2 id="pause-overlay-title" className="pause-overlay__title">
          Paused
        </h2>
        <p
          id="pause-overlay-status"
          className="pause-overlay__status"
          role="status"
          aria-live="polite"
        >
          Game paused. Use the buttons below to continue.
        </p>
        <div className="pause-overlay__actions">
          <button
            type="button"
            ref={resumeRef}
            className="pause-overlay__button pause-overlay__button--primary"
            onClick={onResume}
          >
            Resume
          </button>
          {onRestart && (
            <button
              type="button"
              className="pause-overlay__button"
              onClick={onRestart}
            >
              Restart
            </button>
          )}
          {onQuit && (
            <button
              type="button"
              className="pause-overlay__button"
              onClick={onQuit}
            >
              Quit
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PauseOverlay;
