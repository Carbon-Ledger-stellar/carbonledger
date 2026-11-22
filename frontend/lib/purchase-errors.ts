/**
 * Actionable purchase-error mapping for the buy flow.
 *
 * Buy-flow usability test #1544 (finding F4) found that a failed purchase only
 * surfaced a generic "Something went wrong" with no cause and no next step.
 * `getPurchaseFailure` turns a thrown error into a plain-language cause plus a
 * concrete next step the user can act on; `formatPurchaseFailure` collapses the
 * two into a single string for the {@link TransactionStatus} `message` prop.
 */

import { getCarbonErrorPlainMessage } from "./carbon-error-codes";
import {
  formatShortfallMessage,
  getShortfall,
  getWalletErrorMessage,
  isSigningCancellation,
  type WalletErrorCode,
} from "./wallet-errors";

export interface PurchaseFailure {
  /** Plain-language description of what went wrong. */
  cause: string;
  /** Concrete next step the user can take. */
  nextStep: string;
}

export interface PurchaseFailureContext {
  /** True when the marketplace contract is currently paused. */
  isPaused?: boolean;
}

/** Wallet error codes that map to a specific, actionable next step. */
const ACTIONABLE_WALLET_CODES: WalletErrorCode[] = [
  "WALLET_NOT_INSTALLED",
  "WALLET_LOCKED",
  "WALLET_PERMISSION_DENIED",
  "WRONG_NETWORK",
  "SESSION_EXPIRED",
  "TRANSACTION_REJECTED",
  "INSUFFICIENT_XLM",
  "ACCOUNT_NOT_ACTIVATED",
];

const NEXT_STEP_BY_WALLET_CODE: Record<WalletErrorCode, string> = {
  WALLET_NOT_INSTALLED: "Install the Freighter extension, then click Retry.",
  WALLET_LOCKED: "Unlock your Freighter wallet, then click Retry.",
  WALLET_PERMISSION_DENIED:
    "Approve CarbonLedger in Freighter's connection prompt, then retry.",
  WRONG_NETWORK: "Switch Freighter to the expected Stellar network, then retry.",
  SESSION_EXPIRED: "Reconnect your wallet, then click Retry.",
  TRANSACTION_REJECTED: "Review the transaction in Freighter and approve it, then retry.",
  SIGNING_CANCELLED: "Click Retry and approve the transaction in Freighter.",
  INSUFFICIENT_XLM: "Add XLM to your wallet to cover fees, then retry.",
  ACCOUNT_NOT_ACTIVATED:
    "Fund and activate your Stellar account (minimum 1 XLM), then retry.",
  UNKNOWN: "Try again. If it keeps failing, contact support.",
};

const NETWORK_PATTERNS: RegExp[] = [
  /timeout|timed?\s*out/i,
  /\bfetch failed\b|failed to fetch|econnrefused|enotfound|network error/i,
  /\bhorizon\b|\brpc\b|node unreachable/i,
];

function isNetworkError(error: unknown): boolean {
  const str = error instanceof Error ? error.message : String(error ?? "");
  return NETWORK_PATTERNS.some((p) => p.test(str));
}

function readWalletCode(error: unknown): WalletErrorCode | null {
  if (typeof error === "string") return error as WalletErrorCode;
  if (error instanceof Error) return error.message as WalletErrorCode;
  return null;
}

const CONTRACT_ERROR_PATTERN =
  /Error\(Contract,\s*#(\d+)\)|contract error[:\s]+(\d+)|CarbonError\((\d+)\)/i;

/**
 * Map a thrown purchase error into a plain-language cause and a recommended
 * next step. Order matters: specific signals (cancellation, balance shortfall,
 * pause state, known wallet codes, contract codes, network errors) are checked
 * before the generic fallback.
 */
export function getPurchaseFailure(
  error: unknown,
  context: PurchaseFailureContext = {},
): PurchaseFailure {
  if (!error) {
    return {
      cause: "Something went wrong while submitting your purchase.",
      nextStep: "Click Retry. If it keeps failing, contact support.",
    };
  }

  // 1. The user dismissed the wallet signing prompt — guide them to retry.
  if (isSigningCancellation(error)) {
    return {
      cause: "You cancelled signing in your wallet.",
      nextStep: "Click Retry and approve the transaction in Freighter to continue.",
    };
  }

  // 2. Insufficient balance — the helper already attached a shortfall to the error.
  const shortfall = getShortfall(error);
  if (shortfall) {
    return {
      cause: formatShortfallMessage(shortfall),
      nextStep: "Add the required balance to your wallet, then click Retry.",
    };
  }

  // 3. Marketplace paused — known up front via the pause state, not from the error.
  if (context.isPaused) {
    return {
      cause: "The carbon marketplace is currently paused by an administrator.",
      nextStep: "Trading is temporarily disabled. Wait for it to resume, then retry.",
    };
  }

  // 4. Known wallet error codes (rejected signing, locked, wrong network, etc.).
  const walletCode = readWalletCode(error);
  if (walletCode && ACTIONABLE_WALLET_CODES.includes(walletCode)) {
    return {
      cause: getWalletErrorMessage(error),
      nextStep: NEXT_STEP_BY_WALLET_CODE[walletCode],
    };
  }

  // 5. Soroban / CarbonError contract codes — use the contract message as the cause.
  const str = error instanceof Error ? error.message : String(error);
  const contractMatch = str.match(CONTRACT_ERROR_PATTERN);
  if (contractMatch) {
    const code = parseInt(contractMatch[1] ?? contractMatch[2] ?? contractMatch[3], 10);
    return {
      cause: getCarbonErrorPlainMessage(code, "carbon_marketplace"),
      nextStep: "Adjust the amount or choose another listing, then click Retry.",
    };
  }

  // 6. Network / timeout errors.
  if (isNetworkError(error)) {
    return {
      cause: "We couldn't reach the Stellar network to submit your purchase.",
      nextStep: "Check your connection and click Retry.",
    };
  }

  // 7. Fallback — preserve a short underlying message when one is available.
  const trimmed = str.trim();
  if (trimmed && trimmed.length <= 160) {
    return {
      cause: `We couldn't complete the purchase: ${trimmed}`,
      nextStep: "Click Retry. If it keeps failing, contact support.",
    };
  }

  return {
    cause: "Something went wrong while submitting your purchase.",
    nextStep: "Click Retry. If it keeps failing, contact support.",
  };
}

/** Collapse a {@link PurchaseFailure} into a single string for inline display. */
export function formatPurchaseFailure(
  error: unknown,
  context: PurchaseFailureContext = {},
): string {
  const { cause, nextStep } = getPurchaseFailure(error, context);
  return `${cause} ${nextStep}`;
}
