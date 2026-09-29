"use client";

import React from 'react';
import { PauseStatus, PauseStatusIndicatorProps } from './types';

const statusConfig: Record<
  PauseStatus,
  { label: string; dotClass: string; badgeClass: string; icon: string }
> = {
  operational: {
    label: 'Contract Active',
    dotClass: 'bg-emerald-500 animate-pulse',
    badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    icon: '●',
  },
  paused: {
    label: 'Contract Paused',
    dotClass: 'bg-rose-500',
    badgeClass: 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800',
    icon: '⏸',
  },
  expiring_soon: {
    label: 'Pause Expiring Soon',
    dotClass: 'bg-amber-500 animate-ping',
    badgeClass: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
    icon: '⚠',
  },
  loading: {
    label: 'Checking Status...',
    dotClass: 'bg-gray-400 animate-pulse',
    badgeClass: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700',
    icon: '◌',
  },
};

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5 gap-1.5',
  md: 'text-sm px-2.5 py-1 gap-2',
  lg: 'text-base px-3.5 py-1.5 gap-2.5',
};

const dotSizes = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
};

export const PauseStatusIndicator: React.FC<PauseStatusIndicatorProps> = ({
  status,
  size = 'md',
  showLabel = true,
  pausedUntil,
  className = '',
}) => {
  const config = statusConfig[status] || statusConfig.operational;

  const formattedRemainingTime = React.useMemo(() => {
    if (!pausedUntil) return null;
    const now = Math.floor(Date.now() / 1000);
    const diff = pausedUntil - now;
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    return `${minutes}m remaining`;
  }, [pausedUntil]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={`inline-flex items-center font-medium rounded-full border transition-colors ${config.badgeClass} ${sizeClasses[size]} ${className}`}
      data-testid="pause-status-indicator"
    >
      <span className="relative flex items-center justify-center">
        <span
          className={`inline-block rounded-full ${config.dotClass} ${dotSizes[size]}`}
          aria-hidden="true"
        />
      </span>
      {showLabel && (
        <span className="whitespace-nowrap">
          {config.label}
          {formattedRemainingTime && status !== 'operational' && (
            <span className="ml-1 opacity-75 font-normal">({formattedRemainingTime})</span>
          )}
        </span>
      )}
    </div>
  );
};

export default PauseStatusIndicator;
