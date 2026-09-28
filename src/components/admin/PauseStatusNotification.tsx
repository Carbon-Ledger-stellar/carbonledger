import React, { useState } from 'react';

/**
 * Mobile-responsive pause status notification and controls.
 *
 * Renders a compact status banner on phones/tablets and a bottom sheet
 * for entering the pause reason. All interactive targets are sized to
 * meet the ~44px minimum touch target guidance for iOS and Android.
 */

export type PauseState = 'active' | 'paused' | 'resuming';

export interface PauseStatusNotificationProps {
  state: PauseState;
  reason?: string;
  pausedBy?: string;
  pausedAt?: string;
  onPause?: (reason: string) => void;
  onResume?: () => void;
}

const STATE_LABEL: Record<PauseState, string> = {
  active: 'Active',
  paused: 'Paused',
  resuming: 'Resuming…',
};

const STATE_TONE: Record<PauseState, string> = {
  active: '#0f9d58',
  paused: '#d93025',
  resuming: '#f4b400',
};

export function PauseStatusNotification({
  state,
  reason,
  pausedBy,
  pausedAt,
  onPause,
  onResume,
}: PauseStatusNotificationProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draftReason, setDraftReason] = useState('');

  const isPaused = state === 'paused';

  const submitReason = () => {
    const trimmed = draftReason.trim();
    if (!trimmed) return;
    onPause?.(trimmed);
    setDraftReason('');
    setSheetOpen(false);
  };

  return (
    <div className="pause-status" role="status" aria-live="polite">
      <style>{`
        .pause-status { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
        .pause-banner {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 16px; border-radius: 12px;
          background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.12);
          flex-wrap: wrap;
        }
        .pause-dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; }
        .pause-meta { display: flex; flex-direction: column; gap: 2px; flex: 1 1 160px; min-width: 0; }
        .pause-title { font-size: 15px; font-weight: 600; color: #202124; }
        .pause-sub { font-size: 13px; color: #5f6368; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .pause-actions { display: flex; gap: 8px; flex: 0 0 auto; }
        .pause-btn {
          min-height: 44px; min-width: 44px; padding: 0 18px;
          border-radius: 22px; border: none; font-size: 15px; font-weight: 600;
          cursor: pointer; touch-action: manipulation;
        }
        .pause-btn-primary { background: #1a73e8; color: #fff; }
        .pause-btn-danger { background: #d93025; color: #fff; }
        .pause-btn-ghost { background: #f1f3f4; color: #202124; }
        .pause-sheet-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.4);
          display: flex; align-items: flex-end; justify-content: center; z-index: 1000;
        }
        .pause-sheet {
          width: 100%; max-width: 560px; background: #fff;
          border-radius: 20px 20px 0 0; padding: 20px 20px 28px;
          box-shadow: 0 -2px 12px rgba(0,0,0,0.2);
          animation: pause-sheet-up 180ms ease-out;
        }
        @keyframes pause-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        .pause-sheet-handle { width: 40px; height: 4px; border-radius: 2px; background: #dadce0; margin: 0 auto 16px; }
        .pause-sheet-title { font-size: 17px; font-weight: 600; color: #202124; margin: 0 0 12px; }
        .pause-sheet-input {
          width: 100%; min-height: 88px; box-sizing: border-box;
          border: 1px solid #dadce0; border-radius: 12px; padding: 12px;
          font-size: 16px; resize: none; font-family: inherit;
        }
        .pause-sheet-actions { display: flex; gap: 12px; margin-top: 16px; }
        .pause-sheet-actions .pause-btn { flex: 1 1 0; }
        @media (max-width: 480px) {
          .pause-banner { padding: 12px; }
          .pause-actions { width: 100%; }
          .pause-actions .pause-btn { flex: 1 1 0; }
        }
      `}</style>

      <div className="pause-banner">
        <span className="pause-dot" style={{ background: STATE_TONE[state] }} aria-hidden="true" />
        <div className="pause-meta">
          <span className="pause-title">{STATE_LABEL[state]}</span>
          <span className="pause-sub">
            {isPaused
              ? [reason, pausedBy, pausedAt].filter(Boolean).join(' · ') || 'No reason provided'
              : 'Automation is running normally'}
          </span>
        </div>
        <div className="pause-actions">
          {isPaused ? (
            <button
              type="button"
              className="pause-btn pause-btn-primary"
              onClick={onResume}
              disabled={state === 'resuming'}
            >
              {state === 'resuming' ? 'Resuming…' : 'Resume'}
            </button>
          ) : (
            <button
              type="button"
              className="pause-btn pause-btn-danger"
              onClick={() => setSheetOpen(true)}
            >
              Pause
            </button>
          )}
        </div>
      </div>

      {sheetOpen && (
        <div
          className="pause-sheet-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Pause reason"
          onClick={() => setSheetOpen(false)}
        >
          <div className="pause-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="pause-sheet-handle" aria-hidden="true" />
            <h2 className="pause-sheet-title">Why are you pausing?</h2>
            <textarea
              className="pause-sheet-input"
              placeholder="Enter a reason for pausing automation"
              value={draftReason}
              onChange={(e) => setDraftReason(e.target.value)}
              autoFocus
            />
            <div className="pause-sheet-actions">
              <button
                type="button"
                className="pause-btn pause-btn-ghost"
                onClick={() => setSheetOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pause-btn pause-btn-danger"
                onClick={submitReason}
                disabled={!draftReason.trim()}
              >
                Confirm pause
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PauseStatusNotification;
