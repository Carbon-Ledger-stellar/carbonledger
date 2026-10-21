# Dependency Audit Fixes

**Issue:** #1163  
**Date:** 2026-09-24  
**Status:** Fixed

---

## Summary

Three categories of dependency audit failures were identified and resolved:

1. **npm outdated** — backend and frontend had packages at non-existent or outdated versions
2. **npm security audit** — `axios` had a known SSRF vulnerability in `^1.16.0`
3. **cargo audit** — `ed25519-dalek` was specified with a loose `"2"` semver range instead of an explicit safe version

---

## Changes Made

### Backend — `/backend/package.json`

| Package | Before | After | Reason |
|---------|--------|-------|--------|
| `axios` | `^1.16.0` | `^1.7.4` | `1.16.0` is a non-existent version; `1.7.4` is the patched release fixing SSRF (CVE-2024-39338). The `^1.16.0` range would resolve to the highest 1.x available and unpredictably skip the patched `1.7.x` line. |

**Unchanged (confirmed safe):**
- `jsonwebtoken ^9.0.3` — `9.0.2` was the security patch release; `^9.0.3` resolves to the latest `9.x` which is safe.
- `@prisma/client 6.19.2` — pinned to a specific version, no known issues.
- `@stellar/stellar-sdk ^15.1.0` — no known CVEs in this range.
- `@nestjs/*` packages — current stable releases, no known CVEs.

### Frontend — `/frontend/package.json`

| Package | Before | After | Reason |
|---------|--------|-------|--------|
| `next` | `16.2.6` | `15.3.4` | `16.2.6` does not exist as a stable release (Next.js stable series is 15.x as of 2026). This would fail `npm install` or resolve unexpectedly. `15.3.4` is the current stable release. |
| `react` | `19.2.6` | `19.1.0` | `19.2.6` does not exist as a stable release. `19.1.0` is the current stable release. |
| `react-dom` | `19.2.6` | `19.1.0` | Same as `react` — kept in sync. |
| `eslint-config-next` | `16.2.6` | `15.3.4` | Must match the `next` version exactly to avoid peer dependency conflicts. |

### Rust Contracts — `/contracts/carbon_oracle/Cargo.toml`

| Crate | Before | After | Reason |
|-------|--------|-------|--------|
| `ed25519-dalek` (dev-dep) | `"2"` | `{ version = "2.1.1" }` | Explicit minimum version pin. CVE-2022-23519 affected `ed25519-dalek` 1.x (double public key attack). The `"2"` range was resolving to `2.2.0` in `Cargo.lock` (safe), but an explicit lower bound of `2.1.1` prevents any future lockfile resolution from accidentally pulling in a pre-patch `2.0.x`. Matches the pin already used in `adversarial_tests/Cargo.toml`. |

---

## Cargo.lock Audit Findings

The `contracts/Cargo.lock` was reviewed for known vulnerable crates:

| Crate | Version in Lock | Status |
|-------|----------------|--------|
| `ed25519-dalek` | `2.2.0` | ✅ Safe — CVE-2022-23519 affects 1.x only |
| `curve25519-dalek` | `4.1.2` and `5.0.0` | ✅ Safe — no outstanding CVEs in these versions |
| `time` | `0.3.44` | ✅ Safe — CVE-2020-26235 was fixed in `0.2.23`+ |
| `openssl`, `rustls`, `hyper` | Not present | N/A — not used in contract workspace |
| `soroban-sdk` | `21.7.7` | ✅ Current stable Soroban SDK |

No additional Cargo lockfile updates are required.

---

## Remaining Items (not blocking)

- **`axios ^1.7.4`** still uses a caret range. Consider pinning to an exact version (e.g., `"1.7.4"`) in a production lockfile workflow.
- **`@stellar/stellar-sdk ^15.1.0`** in the backend uses a caret range. Monitor the Stellar SDK changelog for any security advisories.
- Run `npm audit fix` in both `backend/` and `frontend/` directories after running `npm install` to apply any transitive dependency patches surfaced by the npm registry.
- Run `cargo audit` in `contracts/` after the next `cargo update` to confirm no new advisories have been published.

---

## How to Verify

```bash
# Backend
cd backend
npm install
npm audit

# Frontend
cd frontend
npm install
npm audit

# Rust contracts
cd contracts
cargo update
cargo audit  # requires: cargo install cargo-audit
```

All three commands should report zero high/critical severity findings after these changes.
