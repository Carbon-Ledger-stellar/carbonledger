-- Migration: add_two_factor_auth
-- Adds TwoFactorAuth and RecoveryCode tables for TOTP/email OTP 2FA (#1079)

CREATE TABLE "TwoFactorAuth" (
    "id"             TEXT         NOT NULL,
    "userId"         TEXT         NOT NULL,
    "enabled"        BOOLEAN      NOT NULL DEFAULT false,
    "totpSecret"     TEXT,                          -- Base32 TOTP secret (encrypted at rest)
    "totpVerified"   BOOLEAN      NOT NULL DEFAULT false,
    "emailEnabled"   BOOLEAN      NOT NULL DEFAULT false,
    "emailOtp"       TEXT,                          -- Bcrypt hash of current email OTP
    "emailOtpExpiry" TIMESTAMP(3),                  -- OTP expiry timestamp
    "emailOtpAttempts" INTEGER    NOT NULL DEFAULT 0,
    "lastUsedAt"     TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwoFactorAuth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TwoFactorAuth_userId_key" ON "TwoFactorAuth"("userId");
CREATE INDEX "TwoFactorAuth_userId_idx" ON "TwoFactorAuth"("userId");

-- Recovery codes for account lockout (#1079)
CREATE TABLE "RecoveryCode" (
    "id"        TEXT         NOT NULL,
    "userId"    TEXT         NOT NULL,
    "codeHash"  TEXT         NOT NULL,   -- Bcrypt hash of the recovery code
    "usedAt"    TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecoveryCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecoveryCode_userId_idx" ON "RecoveryCode"("userId");
CREATE INDEX "RecoveryCode_userId_usedAt_idx" ON "RecoveryCode"("userId", "usedAt");
