import React, { useState } from 'react';

const MAX_REASON_LENGTH = 200;

const PRESET_REASONS: { value: string; label: string }[] = [
  { value: '', label: 'Select a reason…' },
  { value: 'maintenance', label: 'Scheduled maintenance' },
  { value: 'incident', label: 'Active incident' },
  { value: 'manual_review', label: 'Manual review required' },
  { value: 'resource_limit', label: 'Resource limit reached' },
  { value: 'custom', label: 'Other (custom reason)' },
];

export interface PauseReasonSelectorProps {
  value?: string;
  onChange?: (reason: string) => void;
  disabled?: boolean;
}

export const PauseReasonSelector: React.FC<PauseReasonSelectorProps> = ({
  value = '',
  onChange,
  disabled = false,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');

  const isCustom = selectedPreset === 'custom';
  const effectiveReason = isCustom ? customReason : selectedPreset;

  const handlePresetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = e.target.value;
    setSelectedPreset(next);
    if (next !== 'custom') {
      onChange?.(next);
    } else {
      onChange?.(customReason);
    }
  };

  const handleCustomChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value.slice(0, MAX_REASON_LENGTH);
    setCustomReason(next);
    onChange?.(next);
  };

  const remaining = MAX_REASON_LENGTH - customReason.length;
  const nearLimit = remaining <= 20;

  return (
    <div className="pause-reason-selector" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
      <label htmlFor="pause-reason-preset" style={{ fontWeight: 600 }}>
        Pause reason
      </label>
      <select
        id="pause-reason-preset"
        value={selectedPreset}
        onChange={handlePresetChange}
        disabled={disabled}
        aria-describedby="pause-reason-help"
        style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc' }}
      >
        {PRESET_REASONS.map((reason) => (
          <option key={reason.value} value={reason.value}>
            {reason.label}
          </option>
        ))}
      </select>

      {isCustom && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <label htmlFor="pause-reason-custom" style={{ fontSize: '0.875rem' }}>
            Custom reason
          </label>
          <textarea
            id="pause-reason-custom"
            value={customReason}
            onChange={handleCustomChange}
            disabled={disabled}
            maxLength={MAX_REASON_LENGTH}
            rows={3}
            placeholder="Describe why this is being paused…"
            aria-describedby="pause-reason-help pause-reason-count"
            style={{ width: '100%', padding: '0.5rem', borderRadius: 4, border: '1px solid #ccc', resize: 'vertical', boxSizing: 'border-box' }}
          />
          <div
            id="pause-reason-count"
            aria-live="polite"
            style={{ alignSelf: 'flex-end', fontSize: '0.75rem', color: nearLimit ? '#c0392b' : '#666' }}
          >
            {customReason.length}/{MAX_REASON_LENGTH}
          </div>
        </div>
      )}

      <p id="pause-reason-help" style={{ margin: 0, fontSize: '0.75rem', color: '#666' }}>
        Choose a preset reason or select “Other” to enter a custom reason. A clear reason helps your team understand why this was paused.
      </p>

      {effectiveReason && (
        <p style={{ margin: 0, fontSize: '0.75rem', color: '#666' }}>
          Selected: <strong>{effectiveReason}</strong>
        </p>
      )}
    </div>
  );
};

export default PauseReasonSelector;
