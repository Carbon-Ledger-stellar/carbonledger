import { useMemo, useState } from 'react';

export interface EsgDateRange {
  startDate: string;
  endDate: string;
}

export interface EsgDateRangeFilterProps {
  value: EsgDateRange;
  onChange: (range: EsgDateRange) => void;
  className?: string;
}

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

export const isValidDateRange = (range: EsgDateRange): boolean => {
  if (!range.startDate || !range.endDate) {
    return false;
  }
  return range.startDate <= range.endDate;
};

export const getRangeValidationError = (range: EsgDateRange): string | null => {
  if (!range.startDate || !range.endDate) {
    return 'Please select both a start and end date.';
  }
  if (range.startDate > range.endDate) {
    return 'End date must be on or after the start date.';
  }
  return null;
};

export const buildPresetRange = (
  preset: '30d' | '90d' | 'ytd',
  today: Date = new Date(),
): EsgDateRange => {
  const endDate = toIsoDate(today);
  if (preset === 'ytd') {
    return { startDate: toIsoDate(new Date(today.getFullYear(), 0, 1)), endDate };
  }
  const days = preset === '30d' ? 30 : 90;
  const start = new Date(today);
  start.setDate(start.getDate() - days);
  return { startDate: toIsoDate(start), endDate };
};

export function EsgDateRangeFilter({ value, onChange, className }: EsgDateRangeFilterProps) {
  const [touched, setTouched] = useState(false);
  const error = useMemo(() => getRangeValidationError(value), [value]);

  const handleStartChange = (startDate: string) => {
    setTouched(true);
    onChange({ ...value, startDate });
  };

  const handleEndChange = (endDate: string) => {
    setTouched(true);
    onChange({ ...value, endDate });
  };

  const applyPreset = (preset: '30d' | '90d' | 'ytd') => {
    setTouched(true);
    onChange(buildPresetRange(preset));
  };

  return (
    <div className={className}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-gray-700">Start date</span>
          <input
            type="date"
            value={value.startDate}
            max={value.endDate || undefined}
            onChange={(event) => handleStartChange(event.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 font-medium text-gray-700">End date</span>
          <input
            type="date"
            value={value.endDate}
            min={value.startDate || undefined}
            onChange={(event) => handleEndChange(event.target.value)}
            className="rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => applyPreset('30d')} className="rounded border border-gray-300 px-2 py-1 text-sm">
            Last 30 days
          </button>
          <button type="button" onClick={() => applyPreset('90d')} className="rounded border border-gray-300 px-2 py-1 text-sm">
            Last 90 days
          </button>
          <button type="button" onClick={() => applyPreset('ytd')} className="rounded border border-gray-300 px-2 py-1 text-sm">
            YTD
          </button>
        </div>
      </div>
      {touched && error ? (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export default EsgDateRangeFilter;
