"use client";

import React from 'react';
import { PauseButtonProps } from './types';

const sizeClasses = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export const PauseButton: React.FC<PauseButtonProps> = ({
  isPaused,
  onInitiateAction,
  isLoading = false,
  disabled = false,
  variant = 'primary',
  size = 'md',
  className = '',
}) => {
  const getButtonStyles = () => {
    if (disabled || isLoading) {
      return 'opacity-60 cursor-not-allowed bg-gray-300 text-gray-600 dark:bg-gray-800 dark:text-gray-400 border-transparent';
    }

    if (isPaused) {
      // Unpause action (green/emerald primary)
      switch (variant) {
        case 'secondary':
          return 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700';
        case 'outline':
          return 'bg-transparent text-emerald-600 border-emerald-500 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-400 dark:hover:bg-emerald-950/30';
        case 'primary':
        default:
          return 'bg-emerald-600 text-white hover:bg-emerald-700 border-transparent shadow-sm dark:bg-emerald-500 dark:hover:bg-emerald-600';
      }
    } else {
      // Pause action (rose/red danger)
      switch (variant) {
        case 'secondary':
          return 'bg-rose-100 text-rose-900 hover:bg-rose-200 border-rose-300 dark:bg-rose-900/40 dark:text-rose-200 dark:border-rose-700';
        case 'outline':
          return 'bg-transparent text-rose-600 border-rose-500 hover:bg-rose-50 dark:text-rose-400 dark:border-rose-400 dark:hover:bg-rose-950/30';
        case 'primary':
        default:
          return 'bg-rose-600 text-white hover:bg-rose-700 border-transparent shadow-sm dark:bg-rose-500 dark:hover:bg-rose-600';
      }
    }
  };

  return (
    <button
      type="button"
      onClick={onInitiateAction}
      disabled={disabled || isLoading}
      aria-busy={isLoading}
      aria-label={isPaused ? 'Unpause contract operations' : 'Pause contract operations'}
      data-testid="pause-action-button"
      className={`inline-flex items-center justify-center font-medium rounded-md border transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 ${sizeClasses[size]} ${getButtonStyles()} ${className}`}
    >
      {isLoading ? (
        <>
          <svg
            className="animate-spin -ml-0.5 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Processing...</span>
        </>
      ) : isPaused ? (
        <>
          <span className="mr-1.5" aria-hidden="true">▶</span>
          <span>Resume Operations</span>
        </>
      ) : (
        <>
          <span className="mr-1.5" aria-hidden="true">⏸</span>
          <span>Emergency Pause</span>
        </>
      )}
    </button>
  );
};

export default PauseButton;
