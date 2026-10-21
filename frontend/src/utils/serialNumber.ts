export interface SerialRange {
  start: string;
  end: string;
}

export type SerialParseResult =
  | { ok: true; type: 'single'; value: string }
  | { ok: true; type: 'range'; value: SerialRange }
  | { ok: false; error: string };

const RANGE_SEPARATOR = /\s*[\u2013\u2014-]\s*/;

/**
 * Parse a pasted serial number or serial range.
 *
 * Accepts a single serial (e.g. "CL-2024-000100") or a range separated by a
 * hyphen or en-dash (e.g. "CL-2024-000100–CL-2024-000200"). Surrounding
 * whitespace is trimmed. Returns a discriminated result so callers can show a
 * helpful error for invalid input.
 */
export function parseSerialInput(input: string): SerialParseResult {
  const trimmed = (input ?? '').trim();

  if (!trimmed) {
    return { ok: false, error: 'Enter a serial number or a range.' };
  }

  const parts = trimmed.split(RANGE_SEPARATOR).filter((part) => part.length > 0);

  if (parts.length === 1) {
    return { ok: true, type: 'single', value: parts[0] };
  }

  if (parts.length === 2) {
    const [start, end] = parts;
    if (!start || !end) {
      return {
        ok: false,
        error: 'Range must include both a start and end serial number.',
      };
    }
    return { ok: true, type: 'range', value: { start, end } };
  }

  return {
    ok: false,
    error:
      'Invalid serial range. Use a single serial or a range like "CL-2024-000100–CL-2024-000200".',
  };
}
