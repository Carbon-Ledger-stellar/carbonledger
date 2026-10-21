# Security Policy: KYC Provider Configuration & Fallback Hardening

## Problem Statement
When `KYC_PROVIDER` or vendor API keys (such as Persona or Jumio) are unset in environment configuration, legacy implementations may fall back to an insecure development mode that returns predictable references (e.g. `dev_kyc_<user_id>`), allowing malicious actors to forge webhook approvals and bypass compliance verification.

---

## Security Requirements & Remediation

1. **Environment Strictness**:
   - In `production` and `staging` environments, if `KYC_PROVIDER` or required API credentials are missing, system initialization MUST fail fast or throw a `ConfigurationError`.
   - Silent fallback to `dev` mode is strictly forbidden in non-local environments.

2. **Unpredictable Development Tokens**:
   - In local development mode (`NODE_ENV === 'development'` or `'test'`), fallback sessions must generate cryptographically random, high-entropy tokens (`crypto.randomBytes(32).toString('hex')`) rather than predictable sequential IDs (`dev_kyc_123`).

3. **Webhook Verification**:
   - Webhook callback endpoints must reject `dev_kyc_` references unless running under an explicit test flag (`ALLOW_INSECURE_DEV_KYC=true`), which is blocked in production CI/CD pipelines.
   - All production webhooks require cryptographic signature verification (HMAC-SHA256).
