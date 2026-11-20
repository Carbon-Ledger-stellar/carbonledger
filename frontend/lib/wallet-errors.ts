import { getCarbonErrorPlainMessage, type ContractName } from "./carbon-error-codes";

export type WalletErrorCode =
  | "WALLET_NOT_INSTALLED"
  | "WALLET_LOCKED"
  | "WALLET_PERMISSION_DENIED"
  | "WRONG_NETWORK"
  | "SESSION_EXPIRED"
  | "TRANSACTION_REJECTED"
  | "SIGNING_CANCELLED"
  | "INSUFFICIENT_XLM"
  | "ACCOUNT_NOT_ACTIVATED"
  | "MARKETPLACE_PAUSED"
  | "INSUFFICIENT_USDC"
  | "UNKNOWN";

const messages: Record<WalletErrorCode, string> = {
  WALLET_NOT_INSTALLED:
    "Freighter wallet is not installed. Please install it from freighter.app to continue.",
  WALLET_LOCKED:
    "Your Freighter wallet is locked. Please unlock the extension and try again.",
  WALLET_PERMISSION_DENIED:
    "Permission denied. Please allow CarbonLedger to connect to your Freighter wallet.",
  WRONG_NETWORK:
    "Your wallet is connected to the wrong network. Please switch to Stellar Testnet in Freighter.",
  SESSION_EXPIRED:
    "Your wallet session has expired. Please reconnect to continue.",
  TRANSACTION_REJECTED:
    "Transaction was rejected. Please try again or contact support if the issue persists.",
  SIGNING_CANCELLED:
    "Signing was cancelled. Click 'Retry' to sign again, or go back to change the amount.",
  INSUFFICIENT_XLM:
    "Insufficient XLM balance to cover transaction fees. Please add XLM to your account.",
  ACCOUNT_NOT_ACTIVATED:
    "Your Stellar account is not activated. You need a minimum of 1 XLM to activate it.",
  MARKETPLACE_PAUSED:
    "The marketplace is currently paused for maintenance. Please try again later.",
  INSUFFICIENT_USDC:
    "Insufficient USDC balance. Please add USDC to your wallet to cover this purchase.",
  UNKNOWN:
    "An unexpected error occurred. Please try again or contact support if the issue persists.",
};

/** Maps a purchase failure cause to an actionable { message, nextStep } pair. */
export interface ActionableError {
  /** Plain-language cause of the failure. */
  message: string;
  /** What the user should do next. */
  nextStep: string;
  /** Whether the purchase can be retried immediately. */
  canRetry: boolean;
}

const PAUSED_PATTERNS = [/paused/i, /MARKETPLACE_PAUSED/i, /contract.*paused/i];
const REJECTED_PATTERNS = [/rejected/i, /TRANSACTION_REJECTED/i];
const SIGNING_CANCELLED_PATTERNS_FULL = [
  /SIGNING_CANCELLED/,
  /user declined/i,
  /user rejected/i,
  /request declined/i,
  /popup closed/i,
  /window closed/i,
];
const INSUFFICIENT_USDC_PATTERNS = [/InsufficientLiquidity/i, /insufficient.*USDC/i, /USDC.*balance/i];
const INSUFFICIENT_XLM_PATTERNS = [/INSUFFICIENT_XLM/i, /insufficient.*XLM/i, /XLM.*balance/i];
const NETWORK_PATTERNS = [/network/i, /timeout/i, /fetch/i, /ECONNREFUSED/i, /503/i, /502/i];

/**
 * Returns a structured actionable error for the buy flow, covering:
 * - Wallet rejected signing
 * - Insufficient USDC balance
 * - Insufficient XLM for fees
 * - Marketplace paused
 * - Network / contract error
 */
export function getPurchaseActionableError(error: unknown): ActionableError {
  const str = error instanceof Error ? error.message : String(error ?? "");

  if (SIGNING_CANCELLED_PATTERNS_FULL.some((p) => p.test(str))) {
    return {
      message: "You cancelled the signing step in Freighter.",
      nextStep: "Click 'Retry' to open the Freighter signing prompt again.",
      canRetry: true,
    };
  }

  if (PAUSED_PATTERNS.some((p) => p.test(str))) {
    return {
      message: "The marketplace is currently paused for maintenance.",
      nextStep: "Check the status banner for updates and try again once it reopens.",
      canRetry: false,
    };
  }

  const shortfall = getShortfall(error);
  if (shortfall && shortfall.asset === "USDC") {
    const missing = Math.max(0, shortfall.required - shortfall.available).toFixed(2);
    return {
      message: `Your wallet has insufficient USDC (need ${shortfall.required.toFixed(2)}, have ${shortfall.available.toFixed(2)}).`,
      nextStep: `Add at least ${missing} USDC to your Stellar wallet and retry.`,
      canRetry: false,
    };
  }

  if (INSUFFICIENT_USDC_PATTERNS.some((p) => p.test(str))) {
    return {
      message: "Your wallet has insufficient USDC to complete this purchase.",
      nextStep: "Add USDC to your Stellar wallet and retry.",
      canRetry: false,
    };
  }

  if (shortfall && shortfall.asset === "XLM") {
    const missing = Math.max(0, shortfall.required - shortfall.available).toFixed(7).replace(/0+$/, "").replace(/\.$/, "");
    return {
      message: `Insufficient XLM to cover network fees (need ${shortfall.required} XLM, have ${shortfall.available} XLM).`,
      nextStep: `Add at least ${missing} XLM to your wallet and retry.`,
      canRetry: false,
    };
  }

  if (INSUFFICIENT_XLM_PATTERNS.some((p) => p.test(str))) {
    return {
      message: "Insufficient XLM to cover transaction fees.",
      nextStep: "Add XLM to your wallet and retry.",
      canRetry: false,
    };
  }

  if (REJECTED_PATTERNS.some((p) => p.test(str))) {
    return {
      message: "The transaction was rejected by the network.",
      nextStep: "Review the transaction details and try again, or contact support.",
      canRetry: true,
    };
  }

  if (NETWORK_PATTERNS.some((p) => p.test(str))) {
    return {
      message: "A network or server error occurred.",
      nextStep: "Check your internet connection and try again.",
      canRetry: true,
    };
  }

  // Try contract error code
  const contractMatch = str.match(/Error\(Contract,\s*#(\d+)\)|contract error[:\s]+(\d+)|CarbonError\((\d+)\)/i);
  if (contractMatch) {
    const code = parseInt(contractMatch[1] ?? contractMatch[2] ?? contractMatch[3], 10);
    return {
      message: getCarbonErrorPlainMessage(code, "carbon_marketplace"),
      nextStep: "Review the error above and try again, or contact support.",
      canRetry: true,
    };
  }

  return {
    message: str || "An unexpected error occurred.",
    nextStep: "Please try again or contact support if the issue persists.",
    canRetry: true,
  };
}

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
