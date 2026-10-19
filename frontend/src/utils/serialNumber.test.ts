import { describe, it, expect } from 'vitest';
import { parseSerialRange, SerialRangeParseError } from './serialNumber';

describe('parseSerialRange', () => {
  it('parses a range separated by a hyphen', () => {
    const result = parseSerialRange('CL-2024-000100-CL-2024-000200');
    expect(result).toEqual({
      start: 'CL-2024-000100',
      end: 'CL-2024-000200',
    });
  });

  it('parses a range separated by an en-dash', () => {
    const result = parseSerialRange('CL-2024-000100\u2013CL-2024-000200');
    expect(result).toEqual({
      start: 'CL-2024-000100',
      end: 'CL-2024-000200',
    });
  });

  it('trims surrounding whitespace from pasted input', () => {
    const result = parseSerialRange('  CL-2024-000100 \u2013 CL-2024-000200  ');
    expect(result).toEqual({
      start: 'CL-2024-000100',
      end: 'CL-2024-000200',
    });
  });

  it('throws a helpful error for invalid input', () => {
    expect(() => parseSerialRange('not-a-range')).toThrow(SerialRangeParseError);
    expect(() => parseSerialRange('not-a-range')).toThrow(
      /valid serial range/i,
    );
  });

  it('throws a helpful error for empty input', () => {
    expect(() => parseSerialRange('   ')).toThrow(SerialRangeParseError);
  });
});
