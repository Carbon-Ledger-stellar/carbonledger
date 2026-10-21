"use client";

import React from 'react';

export type PauseErrorCode =
  | 'NETWORK_ERROR'
  | 'PERMISSION_DENIED'
  | 'RPC_TIMEOUT'
  | 'INVALID_STATE_TRANSITION'
  | 'UNKNOWN_ERROR';

interface PauseErrorFallbackProps {
  code: PauseErrorCode;
  message?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}

const errorDetails: Record<
  PauseErrorCode,
  { title: string; defaultMessage: string; resolution: string; isRecoverable: boolean }
> = {
  NETWORK_ERROR: {
    title: 'Network Communication Error',
    defaultMessage: 'Unable to reach the Stellar RPC node or backend API.',
    resolution: 'Check your internet connection and verify RPC endpoint availability.',
    isRecoverable: true,
  },
  PERMISSION_DENIED: {
    title: 'Unauthorized Administrator Action',
    defaultMessage: 'The connected account is not authorized to execute pause operations.',
    resolution: 'Switch to the designated multi-sig admin wallet configured in the contract.',
    isRecoverable: false,
  },
  RPC_TIMEOUT: {
    title: 'Soroban RPC Request Timed Out',
    defaultMessage: 'The Soroban transaction simulation or submission took too long to complete.',
    resolution: 'Wait 30 seconds and check ledger status before retrying.',
    isRecoverable: true,
  },
  INVALID_STATE_TRANSITION: {
    title: 'Invalid Contract State Transition',
    defaultMessage: 'The contract is already in the requested state or pause duration is invalid.',
    resolution: 'Refresh the dashboard to inspect the current on-chain state.',
    isRecoverable: true,
  },
  UNKNOWN_ERROR: {
    title: 'Unexpected Error',
    defaultMessage: 'An unanticipated exception occurred during pause state handling.',
    resolution: 'Please check browser console and platform status logs.',
    isRecoverable: true,
  },
};

export const PauseErrorFallback: React.FC<PauseErrorFallbackProps> = ({
  code,
  message,
  onRetry,
  onDismiss,
  className = '',
}) => {
  const info = errorDetails[code] || errorDetails.UNKNOWN_ERROR;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="pause-error-fallback"
      className={`rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 text-rose-500 dark:text-rose-400 mt-0.5" aria-hidden="true">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </span>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-rose-950 dark:text-rose-100">
            {info.title}
          </h3>
          <p className="mt-1 text-xs text-rose-800 dark:text-rose-300">
            {message || info.defaultMessage}
          </p>
          <p className="mt-1 text-xs text-rose-700/80 dark:text-rose-400/80">
            <strong>Remediation:</strong> {info.resolution}
          </p>

          <div className="mt-3 flex items-center gap-3">
            {info.isRecoverable && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 dark:bg-rose-600 dark:hover:bg-rose-700"
              >
                Retry Request
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="rounded px-2.5 py-1 text-xs font-semibold text-rose-800 hover:text-rose-950 hover:bg-rose-100/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-600 focus-visible:ring-offset-2 dark:text-rose-200 dark:hover:text-rose-100 dark:hover:bg-rose-900/40"
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PauseErrorFallback;
