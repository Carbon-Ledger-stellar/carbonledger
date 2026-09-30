"use client";

import React, { useState } from 'react';
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
      className={`w-full bg-rose-700 text-white px-4 py-3 shadow-md motion-reduce:transition-none dark:bg-rose-950 dark:border-b dark:border-rose-800 ${className}`}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-start sm:items-center space-x-3 text-sm">
          <span className="flex-shrink-0 bg-white/20 p-1.5 rounded-full" aria-hidden="true">
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
          <div className="leading-snug">
            <span className="font-semibold tracking-wide uppercase text-xs mr-2 bg-white/20 px-2 py-0.5 rounded">
              Emergency Notice
            </span>
            <span className="font-medium">
              CarbonLedger contract operations are temporarily paused.
            </span>{' '}
            <span className="text-white/95">
              {reason || 'Transfers, minting, and retirements are temporarily halted for system security.'}
            </span>
            {remaining && (
              <span className="block sm:inline sm:ml-2 text-rose-100 font-medium">
                (Estimated resolution: {remaining})
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3 flex-shrink-0 self-end sm:self-center">
          {onViewDetails && (
            <button
              type="button"
              onClick={onViewDetails}
              className="text-xs font-semibold bg-white text-rose-800 hover:bg-rose-50 px-3 py-1.5 rounded shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white dark:bg-rose-900 dark:text-rose-100 dark:hover:bg-rose-800 dark:focus-visible:ring-rose-300"
            >
              Details
            </button>
          )}

          {isDismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss pause notification"
              className="p-1 rounded-md text-white/90 hover:text-white hover:bg-white/10 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-white"
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
