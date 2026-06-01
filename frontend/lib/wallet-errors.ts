export type WalletErrorCode =
  | "WALLET_NOT_INSTALLED"
  | "WALLET_PERMISSION_DENIED"
  | "WRONG_NETWORK"
  | "TRANSACTION_REJECTED"
  | "INSUFFICIENT_XLM"
  | "ACCOUNT_NOT_ACTIVATED"
  | "UNKNOWN";

const messages: Record<WalletErrorCode, string> = {
  WALLET_NOT_INSTALLED:
    "Freighter wallet is not installed. Please install it from freighter.app to continue.",
  WALLET_PERMISSION_DENIED:
    "Permission denied. Please allow CarbonLedger to connect to your Freighter wallet.",
  WRONG_NETWORK:
    "Your wallet is connected to the wrong network. Please switch to Stellar Testnet in Freighter.",
  TRANSACTION_REJECTED:
    "Transaction was rejected. Please try again or contact support if the issue persists.",
  INSUFFICIENT_XLM:
    "Insufficient XLM balance to cover transaction fees. Please add XLM to your account.",
  ACCOUNT_NOT_ACTIVATED:
    "Your Stellar account is not activated. You need a minimum of 1 XLM to activate it.",
  UNKNOWN:
    "An unexpected error occurred. Please try again.",
};

// Contract error codes from CarbonError enum (error number → plain language)
const contractErrors: Record<number, string> = {
  1:  "Project not found. The project ID may be incorrect.",
  2:  "Project is not yet verified. Credits cannot be retired until the project is approved.",
  3:  "Project is suspended. Retirement is not allowed while the project is under investigation.",
  4:  "Insufficient credits. You don't have enough credits in this batch to retire that amount.",
  5:  "These credits have already been retired and cannot be retired again.",
  6:  "Serial number conflict detected. Please contact support.",
  7:  "You are not an authorized verifier for this action.",
  8:  "You are not an authorized oracle for this action.",
  9:  "Invalid vintage year.",
  10: "Listing not found.",
  11: "Insufficient liquidity in this listing.",
  12: "Price has not been set for this credit type.",
  13: "Monitoring data is stale. The project's satellite data is more than 365 days old.",
  14: "Double-counting detected. These credits may have already been issued elsewhere.",
  15: "Retirement is irreversible. This operation cannot be undone.",
  16: "Amount must be greater than zero.",
  17: "A project with this ID already exists.",
  18: "Invalid serial number range.",
};

/** Extract a plain-language message from a contract error response. */
export function getContractErrorMessage(error: unknown): string {
  if (!error) return messages.UNKNOWN;

  const str = error instanceof Error ? error.message : String(error);

  // Soroban contract errors surface as "Error(Contract, #N)" or "contract error: N"
  const match = str.match(/Error\(Contract,\s*#(\d+)\)|contract error[:\s]+(\d+)/i);
  if (match) {
    const code = parseInt(match[1] ?? match[2], 10);
    return contractErrors[code] ?? `Contract error ${code}. Please contact support.`;
  }

  return getWalletErrorMessage(error);
}

export function getWalletErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    const code = error as WalletErrorCode;
    return messages[code] ?? messages.UNKNOWN;
  }
  if (error instanceof Error) {
    const code = error.message as WalletErrorCode;
    return messages[code] ?? error.message;
  }
  return messages.UNKNOWN;
}

export function isWalletError(error: unknown, code: WalletErrorCode): boolean {
  if (typeof error === "string") return error === code;
  if (error instanceof Error) return error.message === code;
  return false;
}
