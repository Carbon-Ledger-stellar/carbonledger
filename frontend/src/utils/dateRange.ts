export interface DateRange {
  start: Date | null;
  end: Date | null;
}

export type DateRangePreset = 'last30d' | 'last90d' | 'ytd';

export interface DateRangeValidationResult {
  valid: boolean;
  error?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Validates a date range. A range is invalid when both bounds are present and
 * the end date falls before the start date.
 */
export function validateDateRange(range: DateRange): DateRangeValidationResult {
  const { start, end } = range;

  if (start && Number.isNaN(start.getTime())) {
    return { valid: false, error: 'Start date is invalid.' };
  }

  if (end && Number.isNaN(end.getTime())) {
    return { valid: false, error: 'End date is invalid.' };
  }

  if (start && end && startOfDay(end).getTime() < startOfDay(start).getTime()) {
    return { valid: false, error: 'End date must be on or after the start date.' };
  }

  return { valid: true };
}

/**
 * Computes the date range for a given preset relative to `now`.
 * - last30d / last90d: inclusive window ending today
 * - ytd: from January 1st of the current year through today
 */
export function getPresetRange(preset: DateRangePreset, now: Date = new Date()): DateRange {
  const end = startOfDay(now);

  switch (preset) {
    case 'last30d': {
      const start = new Date(end.getTime() - 29 * MS_PER_DAY);
      return { start, end };
    }
    case 'last90d': {
      const start = new Date(end.getTime() - 89 * MS_PER_DAY);
      return { start, end };
    }
    case 'ytd': {
      const start = new Date(end.getFullYear(), 0, 1);
      return { start, end };
    }
    default:
      return { start: null, end: null };
  }
}
