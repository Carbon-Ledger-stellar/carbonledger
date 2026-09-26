/**
 * Canonical CarbonError code → plain-language message tables.
 *
 * Every CarbonLedger contract (carbon_registry, carbon_credit,
 * carbon_marketplace, carbon_oracle) shares the same `CarbonError` variants
 * for codes 1–18; each contract then defines a handful of contract-specific
 * variants at different numeric codes (see each contract crate's src/lib.rs). Callers
 * that know which contract raised the error should pass `contract` so the
 * correct table is used; callers that don't can rely on the shared 1–18
 * table, which is identical everywhere.
 */

export type ContractName = "carbon_registry" | "carbon_credit" | "carbon_marketplace" | "carbon_oracle";

export interface CarbonErrorEntry {
  variant: string;
  message: string;
}

// Codes 1-18: identical CarbonError variants across every contract.
const SHARED_ERRORS: Record<number, CarbonErrorEntry> = {
  1: { variant: "ProjectNotFound", message: "Project not found. The project ID may be incorrect." },
  2: { variant: "ProjectNotVerified", message: "Project is not yet verified. Credits cannot be retired until the project is approved." },
  3: { variant: "ProjectSuspended", message: "Project is suspended. This action is not allowed while the project is under investigation." },
  4: { variant: "InsufficientCredits", message: "Insufficient credits. You don't have enough credits in this batch to complete this action." },
  5: { variant: "AlreadyRetired", message: "These credits have already been retired and cannot be retired again." },
  6: { variant: "SerialNumberConflict", message: "Serial number conflict detected. Please contact support." },
  7: { variant: "UnauthorizedVerifier", message: "You are not an authorized verifier for this action." },
  8: { variant: "UnauthorizedOracle", message: "You are not an authorized oracle for this action." },
  9: { variant: "InvalidVintageYear", message: "Invalid vintage year." },
  10: { variant: "ListingNotFound", message: "Listing not found." },
  11: { variant: "InsufficientLiquidity", message: "Insufficient liquidity in this listing." },
  12: { variant: "PriceNotSet", message: "Price has not been set for this credit type." },
  13: { variant: "MonitoringDataStale", message: "Monitoring data is stale. The project's satellite data is more than 365 days old." },
  14: { variant: "DoubleCountingDetected", message: "Double-counting detected. These credits may have already been issued elsewhere." },
  15: { variant: "RetirementIrreversible", message: "Retirement is irreversible. This operation cannot be undone." },
  16: { variant: "ZeroAmountNotAllowed", message: "Amount must be greater than zero." },
  17: { variant: "ProjectAlreadyExists", message: "A project with this ID already exists." },
  18: { variant: "InvalidSerialRange", message: "Invalid serial number range." },
};

const REGISTRY_ONLY: Record<number, CarbonErrorEntry> = {
  19: { variant: "AlreadyInitialized", message: "This contract has already been initialized." },
  20: { variant: "MethodologyScoreLow", message: "Methodology score is too low to register this project." },
  21: { variant: "UnauthorizedUpgrade", message: "You are not authorized to upgrade this contract." },
  22: { variant: "Arithmetic", message: "An internal calculation error occurred. Please contact support." },
};

const CREDIT_ONLY: Record<number, CarbonErrorEntry> = {
  19: { variant: "BatchTooLarge", message: "This credit batch is too large. Please split it into smaller batches." },
  20: { variant: "AlreadyInitialized", message: "This contract has already been initialized." },
  21: { variant: "Arithmetic", message: "An internal calculation error occurred. Please contact support." },
  22: { variant: "UnauthorizedUpgrade", message: "You are not authorized to upgrade this contract." },
};

const MARKETPLACE_ONLY: Record<number, CarbonErrorEntry> = {
  19: { variant: "AlreadyInitialized", message: "This contract has already been initialized." },
  20: { variant: "Arithmetic", message: "An internal calculation error occurred. Please contact support." },
  21: { variant: "UnauthorizedUpgrade", message: "You are not authorized to upgrade this contract." },
};

const ORACLE_ONLY: Record<number, CarbonErrorEntry> = {
  19: { variant: "AlreadyInitialized", message: "This contract has already been initialized." },
  20: { variant: "Arithmetic", message: "An internal calculation error occurred. Please contact support." },
  21: { variant: "UnauthorizedUpgrade", message: "You are not authorized to upgrade this contract." },
  22: { variant: "InvalidNonce", message: "This oracle submission's nonce has already been used or is out of order." },
  23: { variant: "InvalidSignature", message: "The oracle submission's signature could not be verified." },
};

const CONTRACT_TABLES: Record<ContractName, Record<number, CarbonErrorEntry>> = {
  carbon_registry: { ...SHARED_ERRORS, ...REGISTRY_ONLY },
  carbon_credit: { ...SHARED_ERRORS, ...CREDIT_ONLY },
  carbon_marketplace: { ...SHARED_ERRORS, ...MARKETPLACE_ONLY },
  carbon_oracle: { ...SHARED_ERRORS, ...ORACLE_ONLY },
};

/** Plain-language messages for the 18 CarbonError codes shared by every contract. */
export const CARBON_ERROR_MESSAGES: Record<number, string> = Object.fromEntries(
  Object.entries(SHARED_ERRORS).map(([code, entry]) => [Number(code), entry.message]),
);

export function getCarbonErrorEntry(code: number, contract?: ContractName): CarbonErrorEntry | undefined {
  if (contract) return CONTRACT_TABLES[contract][code];
  return SHARED_ERRORS[code] ?? CONTRACT_TABLES.carbon_registry[code];
}

export function getCarbonErrorPlainMessage(code: number, contract?: ContractName): string {
  return getCarbonErrorEntry(code, contract)?.message ?? `Contract error ${code}. Please contact support.`;
}
