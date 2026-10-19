import { useState } from 'react';

interface SerialNumberLookupProps {
  onLookup?: (serial: string) => void;
}

interface ParsedRange {
  start: string;
  end: string;
}

const RANGE_SEPARATOR = /\s*[\u2013\u2014-]\s*/;

function trimSerial(value: string): string {
  return value.trim();
}

function parseSerialRange(input: string): ParsedRange | null {
  const trimmed = trimSerial(input);
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(RANGE_SEPARATOR);
  if (parts.length !== 2) {
    return null;
  }

  const start = trimSerial(parts[0]);
  const end = trimSerial(parts[1]);
  if (!start || !end) {
    return null;
  }

  return { start, end };
}

export default function SerialNumberLookup({ onLookup }: SerialNumberLookupProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = trimSerial(value);

    if (!trimmed) {
      setError('Enter a serial number or a range like CL-2024-000100–CL-2024-000200.');
      return;
    }

    const range = parseSerialRange(trimmed);
    if (range) {
      setError(null);
      onLookup?.(`${range.start}–${range.end}`);
      return;
    }

    if (RANGE_SEPARATOR.test(trimmed)) {
      setError(
        'That range could not be parsed. Use the format START–END, e.g. CL-2024-000100–CL-2024-000200.'
      );
      return;
    }

    setError(null);
    onLookup?.(trimmed);
  };

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="serial-number-lookup">Serial number or range</label>
      <input
        id="serial-number-lookup"
        type="text"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          if (error) {
            setError(null);
          }
        }}
        placeholder="CL-2024-000100–CL-2024-000200"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'serial-number-lookup-error' : undefined}
      />
      {error && (
        <p id="serial-number-lookup-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit">Look up</button>
    </form>
  );
}

export { parseSerialRange, trimSerial };
