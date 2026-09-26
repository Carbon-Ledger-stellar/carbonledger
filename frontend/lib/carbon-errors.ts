import { CARBON_ERROR_MESSAGES, getCarbonErrorPlainMessage } from "./carbon-error-codes";

/** @deprecated Use CARBON_ERROR_MESSAGES from ./carbon-error-codes, which reflects the actual contract enums. */
export const CarbonErrorMessages = CARBON_ERROR_MESSAGES;

export function getCarbonErrorMessage(error: any): string | null {
  if (!error) return null;

  // Handle cases where the error message contains the code, e.g., "CarbonError(1)", "Error(Contract, #1)", or "Error: 1"
  const str = error.toString();
  const match =
    str.match(/CarbonError\((\d+)\)/) ||
    str.match(/Error\(Contract,\s*#(\d+)\)/) ||
    str.match(/Error:\s*(\d+)/);
  if (match) {
    return getCarbonErrorPlainMessage(parseInt(match[1], 10));
  }

  // If the error message is just a number
  if (!isNaN(parseInt(error, 10))) {
    return getCarbonErrorPlainMessage(parseInt(error, 10));
  }

  return null;
}
