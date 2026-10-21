import React, { useCallback, useId, useState } from 'react';

/**
 * PauseButton
 *
 * Accessible pause/resume control that meets WCAG 2.1 AA:
 * - Text/icon contrast ratio >= 4.5:1 (see PAUSE_STYLES below)
 * - Fully keyboard operable (native <button>, Enter/Space handled by the browser)
 * - Screen readers announce pause status via aria-pressed + a polite live region
 * - Visible focus indicator via :focus-visible outline
 */

export interface PauseButtonProps {
  /** Whether the media/process is currently paused. */
  paused: boolean;
  /** Called when the user toggles the paused state. */
  onToggle: (nextPaused: boolean) => void;
  /** Optional accessible label override. */
  label?: string;
  /** Optional extra class names. */
  className?: string;
  /** Disable the control (e.g. nothing to pause yet). */
  disabled?: boolean;
}

// Contrast-checked palette (WCAG 2.1 AA, >= 4.5:1 against the paired background).
// #0b3d91 on #ffffff  -> ~10.4:1
// #ffffff on #0b3d91  -> ~10.4:1
const PAUSE_STYLES: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.5rem',
  padding: '0.5rem 0.875rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  lineHeight: 1.2,
  borderRadius: '0.375rem',
  border: '2px solid #0b3d91',
  cursor: 'pointer',
  color: '#0b3d91',
  backgroundColor: '#ffffff',
};

const PAUSE_STYLES_ACTIVE: React.CSSProperties = {
  ...PAUSE_STYLES,
  color: '#ffffff',
  backgroundColor: '#0b3d91',
};

const FOCUS_STYLES = `
.pause-button:focus-visible {
  outline: 3px solid #0b3d91;
  outline-offset: 2px;
}
.pause-button[aria-pressed="true"]:focus-visible {
  outline-color: #ffffff;
  box-shadow: 0 0 0 5px #0b3d91;
}
`;

export function PauseButton({
  paused,
  onToggle,
  label,
  className,
  disabled = false,
}: PauseButtonProps): JSX.Element {
  const statusId = useId();
  const [announcement, setAnnouncement] = useState('');

  const handleClick = useCallback(() => {
    const next = !paused;
    onToggle(next);
    setAnnouncement(next ? 'Paused' : 'Resumed');
  }, [paused, onToggle]);

  const accessibleLabel = label ?? (paused ? 'Resume' : 'Pause');

  return (
    <>
      <style>{FOCUS_STYLES}</style>
      <button
        type="button"
        className={['pause-button', className].filter(Boolean).join(' ')}
        style={paused ? PAUSE_STYLES_ACTIVE : PAUSE_STYLES}
        aria-pressed={paused}
        aria-label={accessibleLabel}
        aria-describedby={statusId}
        disabled={disabled}
        onClick={handleClick}
      >
        <span aria-hidden="true">{paused ? '\u25B6' : '\u23F8'}</span>
        <span>{accessibleLabel}</span>
      </button>
      {/* Visually hidden status text so screen readers announce pause state changes. */}
      <span
        id={statusId}
        role="status"
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: 'hidden',
          clip: 'rect(0, 0, 0, 0)',
          whiteSpace: 'nowrap',
          border: 0,
        }}
      >
        {announcement}
      </span>
    </>
  );
}

export default PauseButton;
