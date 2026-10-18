"use client";

import React, { useEffect, useState } from 'react';
import { PauseBannerProps } from './types';

export const PauseBanner: React.FC<PauseBannerProps> = ({
  isPaused,
  reason,
  pausedUntil,
  pausedBy,
  onDismiss,
  isDismissible = true,
  onViewDetails,
  className = '',
}) => {
  const [dismissed, setDismissed] = useState(false);
  const [, setClock] = useState(() => Date.now());

  useEffect(() => {
    if (!isPaused || !pausedUntil) return;
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [isPaused, pausedUntil]);

  if (!isPaused || dismissed) {
    return null;
  }

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  const formattedRemainingTime = () => {
    if (!pausedUntil) return null;
    const now = Math.floor(Date.now() / 1000);
    const diff = pausedUntil - now;
    if (diff <= 0) return 'Pause window expired';
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const remaining = formattedRemainingTime();

  return (
    <aside
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      data-testid="pause-banner"
      className={`pause-system-banner ${className}`}
    >
      <div className="pause-system-banner__inner">
        <div className="pause-system-banner__message">
          <span className="pause-system-banner__icon" aria-hidden="true">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </span>
          <div className="pause-system-banner__copy">
            <span className="pause-system-banner__eyebrow">
              Emergency Notice
            </span>
            <strong>
              CarbonLedger contract operations are temporarily paused.
            </strong>
            <span>
              {reason || 'Transfers, minting, and retirements are temporarily halted for system security.'}
            </span>
            {remaining && (
              <span className="pause-system-banner__remaining">
                (Estimated resolution: {remaining})
              </span>
            )}
          </div>
        </div>

        <div className="pause-system-banner__actions">
          {onViewDetails && (
            <button
              type="button"
              onClick={onViewDetails}
              className="pause-system-banner__details"
            >
              Details
            </button>
          )}

          {isDismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss pause notification"
              className="pause-system-banner__dismiss"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </aside>
  );
};

export default PauseBanner;
