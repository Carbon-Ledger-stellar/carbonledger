import { Injectable } from "@nestjs/common";

export interface LockoutInfo {
  attempts: number;
  lockedUntil: Date | null;
  isLocked: boolean;
}

interface LockoutEntry {
  attempts: number;
  lockedUntil: number | null; // epoch ms
}

/** How many consecutive failures trigger a lockout. */
export const LOCKOUT_THRESHOLD = 10;

/** How long an account stays locked (30 minutes). */
export const LOCKOUT_DURATION_MS = 30 * 60 * 1000;

/**
 * In-memory service that tracks failed login attempts per Stellar public key
 * and enforces a 30-minute account lockout after 10 consecutive failures.
 *
 * NOTE: This is intentionally in-memory.  In a multi-instance deployment,
 * replace the Map with a shared Redis store to keep state consistent across
 * replicas.  The interface (recordFailedAttempt / isLockedOut / unlock) is
 * stable and can be swapped without touching callers.
 */
@Injectable()
export class AccountLockoutService {
  private readonly store = new Map<string, LockoutEntry>();

  /**
   * Record a failed authentication attempt for the given public key.
   * If the attempt count reaches LOCKOUT_THRESHOLD, the account is locked
   * for LOCKOUT_DURATION_MS milliseconds.
   */
  recordFailedAttempt(publicKey: string): void {
    const now = Date.now();
    const entry = this.store.get(publicKey) ?? { attempts: 0, lockedUntil: null };

    // If a previous lockout has already expired, reset state first
    if (entry.lockedUntil !== null && now > entry.lockedUntil) {
      entry.attempts = 0;
      entry.lockedUntil = null;
    }

    entry.attempts += 1;

    if (entry.attempts >= LOCKOUT_THRESHOLD) {
      entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    }

    this.store.set(publicKey, entry);
  }

  /**
   * Returns true if the given public key is currently locked out.
   * Expired lockouts are lazily cleared on this call.
   */
  isLockedOut(publicKey: string): boolean {
    const entry = this.store.get(publicKey);
    if (!entry || entry.lockedUntil === null) return false;

    if (Date.now() > entry.lockedUntil) {
      // Lockout has expired — clean up and allow login
      this.store.delete(publicKey);
      return false;
    }

    return true;
  }

  /**
   * Clears the failed-attempt counter and any active lockout for the
   * given public key.  Call this on successful authentication.
   */
  unlock(publicKey: string): void {
    this.store.delete(publicKey);
  }

  /**
   * Returns diagnostic information about a public key's lockout state.
   * Used by the admin endpoint.
   */
  getLockoutInfo(publicKey: string): LockoutInfo {
    const entry = this.store.get(publicKey);
    if (!entry) {
      return { attempts: 0, lockedUntil: null, isLocked: false };
    }

    const now = Date.now();
    const isLocked = entry.lockedUntil !== null && now <= entry.lockedUntil;

    // Clean up if lockout has expired
    if (entry.lockedUntil !== null && now > entry.lockedUntil) {
      this.store.delete(publicKey);
      return { attempts: 0, lockedUntil: null, isLocked: false };
    }

    return {
      attempts: entry.attempts,
      lockedUntil: entry.lockedUntil ? new Date(entry.lockedUntil) : null,
      isLocked,
    };
  }

  /**
   * Removes all lockout entries.  Intended for test teardown only.
   */
  clearAllLockouts(): void {
    this.store.clear();
  }
}
