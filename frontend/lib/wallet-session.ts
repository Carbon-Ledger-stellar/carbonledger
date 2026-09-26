/**
 * sessionStorage-backed persistence for the wallet connection.
 *
 * Deliberately sessionStorage (not localStorage): a connected wallet should
 * survive a page reload within the same tab session, but not silently persist
 * across browser restarts or new tabs where the user hasn't re-established intent.
 */

import type { FreighterNetwork } from "./freighter";

const STORAGE_KEY = "carbonledger_wallet_session";

export interface StoredWalletSession {
  publicKey: string;
  network: FreighterNetwork;
  connectedAt: number;
}

function hasSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function saveWalletSession(session: StoredWalletSession): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Storage may be unavailable (private browsing, quota) — session persistence is best-effort.
  }
}

export function loadWalletSession(): StoredWalletSession | null {
  if (!hasSessionStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.publicKey === "string" &&
      typeof parsed?.network === "string" &&
      typeof parsed?.connectedAt === "number"
    ) {
      return parsed as StoredWalletSession;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearWalletSession(): void {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort clear.
  }
}
