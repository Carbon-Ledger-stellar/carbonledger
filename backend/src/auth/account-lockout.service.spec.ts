import { AccountLockoutService, LOCKOUT_THRESHOLD, LOCKOUT_DURATION_MS } from "./account-lockout.service";

describe("AccountLockoutService", () => {
  let service: AccountLockoutService;

  beforeEach(() => {
    service = new AccountLockoutService();
  });

  afterEach(() => {
    service.clearAllLockouts();
    jest.useRealTimers();
  });

  const KEY = "GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGP35PJLYOQ8RQEABKN1CK";
  const KEY2 = "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6";

  // ── 1. Initial state ────────────────────────────────────────────────────────

  describe("initial state", () => {
    it("isLockedOut returns false for an unknown public key", () => {
      expect(service.isLockedOut(KEY)).toBe(false);
    });

    it("getLockoutInfo returns zero attempts and no lockout for unknown key", () => {
      const info = service.getLockoutInfo(KEY);
      expect(info.attempts).toBe(0);
      expect(info.lockedUntil).toBeNull();
      expect(info.isLocked).toBe(false);
    });
  });

  // ── 2. Recording failed attempts ───────────────────────────────────────────

  describe("recordFailedAttempt", () => {
    it("increments attempt counter on each call", () => {
      service.recordFailedAttempt(KEY);
      service.recordFailedAttempt(KEY);
      expect(service.getLockoutInfo(KEY).attempts).toBe(2);
    });

    it("does not lock out before threshold", () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
        service.recordFailedAttempt(KEY);
      }
      expect(service.isLockedOut(KEY)).toBe(false);
    });

    it("locks the account exactly at the threshold", () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
      }
      expect(service.isLockedOut(KEY)).toBe(true);
    });

    it("keeps the account locked after attempts exceed the threshold", () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD + 5; i++) {
        service.recordFailedAttempt(KEY);
      }
      expect(service.isLockedOut(KEY)).toBe(true);
    });

    it("tracks attempts independently per public key", () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
      }
      expect(service.isLockedOut(KEY)).toBe(true);
      expect(service.isLockedOut(KEY2)).toBe(false);
    });
  });

  // ── 3. Lockout duration ────────────────────────────────────────────────────

  describe("lockout duration", () => {
    it("getLockoutInfo returns a lockedUntil date ~30 minutes in the future", () => {
      const before = Date.now();
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
      }
      const after = Date.now();

      const { lockedUntil } = service.getLockoutInfo(KEY);
      expect(lockedUntil).not.toBeNull();
      const lockMs = lockedUntil!.getTime();
      expect(lockMs).toBeGreaterThanOrEqual(before + LOCKOUT_DURATION_MS);
      expect(lockMs).toBeLessThanOrEqual(after + LOCKOUT_DURATION_MS + 100);
    });

    it("isLockedOut returns false after the lockout period has elapsed", () => {
      jest.useFakeTimers();

      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
      }
      expect(service.isLockedOut(KEY)).toBe(true);

      // Advance time past the lockout duration
      jest.advanceTimersByTime(LOCKOUT_DURATION_MS + 1);

      expect(service.isLockedOut(KEY)).toBe(false);
    });

    it("getLockoutInfo clears expired state and returns zero attempts", () => {
      jest.useFakeTimers();

      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
      }

      jest.advanceTimersByTime(LOCKOUT_DURATION_MS + 1);

      const info = service.getLockoutInfo(KEY);
      expect(info.isLocked).toBe(false);
      expect(info.attempts).toBe(0);
      expect(info.lockedUntil).toBeNull();
    });
  });

  // ── 4. Unlock / reset ──────────────────────────────────────────────────────

  describe("unlock", () => {
    it("clears the attempt counter", () => {
      service.recordFailedAttempt(KEY);
      service.recordFailedAttempt(KEY);
      service.unlock(KEY);
      expect(service.getLockoutInfo(KEY).attempts).toBe(0);
    });

    it("clears an active lockout", () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
      }
      expect(service.isLockedOut(KEY)).toBe(true);

      service.unlock(KEY);
      expect(service.isLockedOut(KEY)).toBe(false);
    });

    it("is a no-op for an unknown public key (no throw)", () => {
      expect(() => service.unlock("UNKNOWN_KEY")).not.toThrow();
    });
  });

  // ── 5. Resuming attempts after lockout expires ────────────────────────────

  describe("attempts after lockout expiry", () => {
    it("resets counter to 1 after a failed attempt when previous lockout expired", () => {
      jest.useFakeTimers();

      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
      }
      jest.advanceTimersByTime(LOCKOUT_DURATION_MS + 1);

      // One new failure after expiry
      service.recordFailedAttempt(KEY);
      expect(service.getLockoutInfo(KEY).attempts).toBe(1);
      expect(service.isLockedOut(KEY)).toBe(false);
    });
  });

  // ── 6. clearAllLockouts ────────────────────────────────────────────────────

  describe("clearAllLockouts", () => {
    it("removes all entries including active lockouts", () => {
      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        service.recordFailedAttempt(KEY);
        service.recordFailedAttempt(KEY2);
      }
      expect(service.isLockedOut(KEY)).toBe(true);
      expect(service.isLockedOut(KEY2)).toBe(true);

      service.clearAllLockouts();

      expect(service.isLockedOut(KEY)).toBe(false);
      expect(service.isLockedOut(KEY2)).toBe(false);
    });
  });
});
