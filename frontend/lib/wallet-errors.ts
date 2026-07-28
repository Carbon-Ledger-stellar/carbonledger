import { getCarbonErrorPlainMessage, type ContractName } from "./carbon-error-codes";

export type WalletErrorCode =
  | "WALLET_NOT_INSTALLED"
  | "WALLET_PERMISSION_DENIED"
  | "WRONG_NETWORK"
  | "TRANSACTION_REJECTED"
  | "SIGNING_CANCELLED"
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
  SIGNING_CANCELLED:
    "Signing was cancelled.",
  INSUFFICIENT_XLM:
    "Insufficient XLM balance to cover transaction fees. Please add XLM to your account.",
  ACCOUNT_NOT_ACTIVATED:
    "Your Stellar account is not activated. You need a minimum of 1 XLM to activate it.",
  UNKNOWN:
    "An unexpected error occurred. Please try again.",
};

/** Patterns matching how Freighter/wallets report that the user closed or declined a signing prompt. */
const SIGNING_CANCELLED_PATTERNS = [
  /SIGNING_CANCELLED/,
  /user declined/i,
  /user rejected/i,
  /request declined/i,
  /popup closed/i,
  /window closed/i,
];

/** True when `error` represents the user dismissing/declining a wallet signing prompt (not a real failure). */
export function isSigningCancellation(error: unknown): boolean {
  const str = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return SIGNING_CANCELLED_PATTERNS.some((p) => p.test(str));
}

export interface BalanceShortfall {
  /** Amount the transaction required. */
  required: number;
  /** Amount actually available in the wallet. */
  available: number;
  asset: string;
}

/** Attach a shortfall to an Error so downstream UI (see ErrorBoundary.classifyError) can render the exact amount. */
export function createInsufficientBalanceError(required: number, available: number, asset = "XLM"): Error {
  const err = new Error("INSUFFICIENT_XLM") as Error & { shortfall: BalanceShortfall };
  err.shortfall = { required, available, asset };
  return err;
}

export function getShortfall(error: unknown): BalanceShortfall | undefined {
  if (error instanceof Error && "shortfall" in error) {
    return (error as Error & { shortfall?: BalanceShortfall }).shortfall;
  }
  return undefined;
}

export function formatShortfallMessage(shortfall: BalanceShortfall): string {
  const missing = Math.max(0, shortfall.required - shortfall.available);
  return `You need ${missing.toFixed(7).replace(/0+$/, "").replace(/\.$/, "")} more ${shortfall.asset} to complete this transaction (${shortfall.available} available, ${shortfall.required} required).`;
}

/** Extract a plain-language message from a contract error response. */
export function getContractErrorMessage(error: unknown, contract?: ContractName): string {
  if (!error) return messages.UNKNOWN;

  const shortfall = getShortfall(error);
  if (shortfall) return formatShortfallMessage(shortfall);

  const str = error instanceof Error ? error.message : String(error);

  // Soroban contract errors surface as "Error(Contract, #N)", "contract error: N", or "CarbonError(N)"
  const match = str.match(/Error\(Contract,\s*#(\d+)\)|contract error[:\s]+(\d+)|CarbonError\((\d+)\)/i);
  if (match) {
    const code = parseInt(match[1] ?? match[2] ?? match[3], 10);
    return getCarbonErrorPlainMessage(code, contract);
  }

  return getWalletErrorMessage(error);
}

export function getWalletErrorMessage(error: unknown): string {
  const shortfall = getShortfall(error);
  if (shortfall) return formatShortfallMessage(shortfall);

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
