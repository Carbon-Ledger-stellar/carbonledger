import { describe, it, expect } from 'vitest';
import {
  isValidDateRange,
  getDateRangeValidationError,
  getPresetRange,
  type DateRangePreset,
} from './dateRange';

describe('isValidDateRange', () => {
  it('returns true when start is before end', () => {
    expect(isValidDateRange('2024-01-01', '2024-01-31')).toBe(true);
  });

  it('returns true when start equals end', () => {
    expect(isValidDateRange('2024-01-01', '2024-01-01')).toBe(true);
  });

  it('returns false when end is before start', () => {
    expect(isValidDateRange('2024-02-01', '2024-01-01')).toBe(false);
  });

  it('returns false when either date is missing', () => {
    expect(isValidDateRange('', '2024-01-01')).toBe(false);
    expect(isValidDateRange('2024-01-01', '')).toBe(false);
    expect(isValidDateRange('', '')).toBe(false);
  });

  it('returns false for unparseable dates', () => {
    expect(isValidDateRange('not-a-date', '2024-01-01')).toBe(false);
  });
});

describe('getDateRangeValidationError', () => {
  it('returns null for a valid range', () => {
    expect(getDateRangeValidationError('2024-01-01', '2024-01-31')).toBeNull();
  });

  it('returns an error message when end is before start', () => {
    expect(getDateRangeValidationError('2024-02-01', '2024-01-01')).toMatch(
      /end date/i,
    );
  });

  it('returns an error message when a date is missing', () => {
    expect(getDateRangeValidationError('', '2024-01-01')).not.toBeNull();
    expect(getDateRangeValidationError('2024-01-01', '')).not.toBeNull();
  });
});

describe('getPresetRange', () => {
  const now = new Date('2024-06-15T12:00:00.000Z');

  it('returns the last 30 days for the 30d preset', () => {
    const range = getPresetRange('30d', now);
    expect(range.end).toBe('2024-06-15');
    expect(range.start).toBe('2024-05-16');
  });

  it('returns the last 90 days for the 90d preset', () => {
    const range = getPresetRange('90d', now);
    expect(range.end).toBe('2024-06-15');
    expect(range.start).toBe('2024-03-17');
  });

  it('returns year-to-date for the ytd preset', () => {
    const range = getPresetRange('ytd', now);
    expect(range.end).toBe('2024-06-15');
    expect(range.start).toBe('2024-01-01');
  });

  it('produces valid ranges for every preset', () => {
    const presets: DateRangePreset[] = ['30d', '90d', 'ytd'];
    for (const preset of presets) {
      const range = getPresetRange(preset, now);
      expect(isValidDateRange(range.start, range.end)).toBe(true);
    }
  });
});
