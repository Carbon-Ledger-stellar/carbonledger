/**
 * Validation Error Catalog
 *
 * Provides standardized error codes, HTTP status codes, and human-readable
 * messages for every validation failure type in the CarbonLedger API.
 *
 * Each entry follows the structure:
 *   code    — Machine-readable unique error code (SCREAMING_SNAKE_CASE)
 *   status  — HTTP status code (always 400 for validation errors)
 *   message — Human-readable explanation of what failed and why
 *   hint    — Optional actionable suggestion for the caller
 */

export interface ValidationError {
  code: string;
  status: number;
  message: string;
  hint?: string;
}

export const ValidationErrorCatalog = {
  // ── Stellar address errors ─────────────────────────────────────────────
  STELLAR_ADDRESS_INVALID: {
    code: 'STELLAR_ADDRESS_INVALID',
    status: 400,
    message: 'The provided Stellar address is not valid.',
    hint: 'A valid Stellar public key starts with "G", is exactly 56 characters long, and uses the base32 alphabet (A–Z, 2–7). Example: GAHJJJKMOKYE4RVPZEWZTKH5FVI4PA3VL7GK2LFNUBSGBV3LRGLDBKB',
  },

  // ── Serial number errors ───────────────────────────────────────────────
  SERIAL_NUMBER_FORMAT: {
    code: 'SERIAL_NUMBER_FORMAT',
    status: 400,
    message: 'Serial number must be a non-negative integer string.',
    hint: 'Provide the serial number as a string of digits only, e.g. "1000". No negative values, decimals, or non-numeric characters.',
  },
  SERIAL_NUMBER_RANGE: {
    code: 'SERIAL_NUMBER_RANGE',
    status: 400,
    message: 'serialEnd must be greater than or equal to serialStart.',
    hint: 'The ending serial number in the range must not be less than the starting serial number.',
  },
  SERIAL_NUMBER_OVERFLOW: {
    code: 'SERIAL_NUMBER_OVERFLOW',
    status: 400,
    message: 'Serial number exceeds the maximum safe integer value (9007199254740991).',
    hint: 'Serial numbers must be within the safe JavaScript integer range.',
  },

  // ── Credit amount errors ───────────────────────────────────────────────
  CREDIT_AMOUNT_TOO_SMALL: {
    code: 'CREDIT_AMOUNT_TOO_SMALL',
    status: 400,
    message: 'Credit amount must be at least 0.01 tCO₂e.',
    hint: 'The minimum tradeable unit is 0.01 tonnes of CO₂ equivalent. Provide a positive number.',
  },
  CREDIT_AMOUNT_TOO_LARGE: {
    code: 'CREDIT_AMOUNT_TOO_LARGE',
    status: 400,
    message: 'Credit amount exceeds the maximum allowed per batch (1,000,000,000 tCO₂e).',
    hint: 'Split large credit batches across multiple mint operations.',
  },
  CREDIT_AMOUNT_DECIMAL_PLACES: {
    code: 'CREDIT_AMOUNT_DECIMAL_PLACES',
    status: 400,
    message: 'Credit amount must have at most 2 decimal places.',
    hint: 'The finest granularity is 0.01 tCO₂e. Round your amount to at most 2 decimal places.',
  },
  CREDIT_AMOUNT_NOT_POSITIVE: {
    code: 'CREDIT_AMOUNT_NOT_POSITIVE',
    status: 400,
    message: 'Credit amount must be a positive number greater than zero.',
    hint: 'Provide a number greater than 0. Zero and negative values are not permitted.',
  },

  // ── Vintage year errors ────────────────────────────────────────────────
  VINTAGE_YEAR_TOO_OLD: {
    code: 'VINTAGE_YEAR_TOO_OLD',
    status: 400,
    message: 'Vintage year must be 1990 or later.',
    hint: 'Carbon credits are only issued for projects with vintage years from 1990 onward (modern carbon accounting era).',
  },
  VINTAGE_YEAR_IN_FUTURE: {
    code: 'VINTAGE_YEAR_IN_FUTURE',
    status: 400,
    message: `Vintage year cannot be more than one year in the future.`,
    hint: `Provide a year between 1990 and ${new Date().getFullYear() + 1}.`,
  },
  VINTAGE_YEAR_NOT_INTEGER: {
    code: 'VINTAGE_YEAR_NOT_INTEGER',
    status: 400,
    message: 'Vintage year must be a whole number (integer).',
    hint: 'Provide the year as a 4-digit integer, e.g. 2023.',
  },

  // ── IPFS CID errors ────────────────────────────────────────────────────
  IPFS_CID_INVALID: {
    code: 'IPFS_CID_INVALID',
    status: 400,
    message: 'The provided value is not a valid IPFS CID.',
    hint: 'Provide a valid CIDv0 (starts with "Qm", 46 chars) or CIDv1 (starts with "b", base32). Upload the file to IPFS first and use the returned CID.',
  },

  // ── Methodology score errors ───────────────────────────────────────────
  METHODOLOGY_SCORE_OUT_OF_RANGE: {
    code: 'METHODOLOGY_SCORE_OUT_OF_RANGE',
    status: 400,
    message: 'Methodology score must be an integer between 0 and 100.',
    hint: 'The methodology score represents a percentage (0–100) of the maximum achievable score under the selected methodology framework.',
  },
  METHODOLOGY_SCORE_BELOW_MINIMUM: {
    code: 'METHODOLOGY_SCORE_BELOW_MINIMUM',
    status: 400,
    message: 'Methodology score is below the minimum required for credit issuance (70).',
    hint: 'Projects must achieve a methodology score of at least 70 to issue carbon credits.',
  },

  // ── String field errors ────────────────────────────────────────────────
  FIELD_REQUIRED: {
    code: 'FIELD_REQUIRED',
    status: 400,
    message: 'A required field is missing or empty.',
    hint: 'Check the request body and ensure all required fields are present and non-empty.',
  },
  FIELD_TOO_LONG: {
    code: 'FIELD_TOO_LONG',
    status: 400,
    message: 'A field value exceeds the maximum allowed length.',
    hint: 'Shorten the value. Refer to the API documentation for field length limits.',
  },
  FIELD_INVALID_FORMAT: {
    code: 'FIELD_INVALID_FORMAT',
    status: 400,
    message: 'A field value does not match the expected format.',
    hint: 'Check the API documentation for the expected format and constraints.',
  },

  // ── Numeric range errors ───────────────────────────────────────────────
  NUMBER_OUT_OF_RANGE: {
    code: 'NUMBER_OUT_OF_RANGE',
    status: 400,
    message: 'A numeric value is outside the permitted range.',
    hint: 'Refer to the API documentation for the minimum and maximum values.',
  },

  // ── Array / bulk operation errors ──────────────────────────────────────
  ARRAY_TOO_LARGE: {
    code: 'ARRAY_TOO_LARGE',
    status: 400,
    message: 'The array exceeds the maximum allowed number of items.',
    hint: 'Reduce the number of items in the array. The maximum for bulk operations is 50.',
  },
  ARRAY_EMPTY: {
    code: 'ARRAY_EMPTY',
    status: 400,
    message: 'The array must contain at least one item.',
    hint: 'Provide at least one item in the array.',
  },
  ARRAY_LENGTH_MISMATCH: {
    code: 'ARRAY_LENGTH_MISMATCH',
    status: 400,
    message: 'Arrays that must be the same length have different lengths.',
    hint: 'Ensure listingIds and amounts arrays have the same number of elements.',
  },

  // ── Unknown field / whitelist errors ──────────────────────────────────
  UNKNOWN_FIELD: {
    code: 'UNKNOWN_FIELD',
    status: 400,
    message: 'The request contains one or more unknown fields.',
    hint: 'Remove unexpected fields from the request body. Only documented fields are accepted.',
  },

  // ── General validation failure ─────────────────────────────────────────
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    status: 400,
    message: 'Request validation failed.',
    hint: 'Review the "errors" array for details on each field that failed validation.',
  },
} as const satisfies Record<string, ValidationError>;

export type ValidationErrorCode = keyof typeof ValidationErrorCatalog;

/**
 * Standard validation error response body.
 * All 400 validation errors from the API follow this shape.
 *
 * @example
 * {
 *   "statusCode": 400,
 *   "error": "Bad Request",
 *   "code": "VALIDATION_FAILED",
 *   "message": "Request validation failed.",
 *   "errors": [
 *     {
 *       "field": "vintageYear",
 *       "code": "VINTAGE_YEAR_TOO_OLD",
 *       "message": "Vintage year must be 1990 or later.",
 *       "hint": "Carbon credits are only issued for projects with vintage years from 1990 onward."
 *     }
 *   ]
 * }
 */
export interface ValidationErrorResponse {
  statusCode: 400;
  error: 'Bad Request';
  code: ValidationErrorCode | 'VALIDATION_FAILED';
  message: string;
  errors: Array<{
    field: string;
    message: string;
    code?: string;
    hint?: string;
  }>;
}
