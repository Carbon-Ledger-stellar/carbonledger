# Vintage Year Validation — Specification

**Status:** Implemented  
**Issue:** Closes #533  
**Contracts affected:** `carbon_credit`, `carbon_registry`, `carbon_marketplace`, `carbon_oracle`

---

## 1. Overview

Every carbon credit on CarbonLedger carries a *vintage year* — the calendar year in which the underlying carbon reduction or removal actually occurred. Vintage year is a fundamental attribute used to:

- Identify the age of a credit for market pricing purposes.
- Prevent creation of credits with implausible future or historical dates.
- Enforce a maximum lifetime after which old-vintage credits can no longer be transferred or retired (expiry).

This document defines the authoritative rules for vintage year validation, the constants used, and the contract enforcement points.

---

## 2. Constants

All four contracts export the following constants:

| Constant | Value | Meaning |
|---|---|---|
| `VINTAGE_YEAR_MIN` | `1990` | Earliest calendar year a vintage can represent. Carbon markets did not exist before the 1990 IPCC baseline; no legitimate credit predates this. |
| `MAX_VINTAGE_AGE_YEARS` | `30` | Maximum number of years a vintage may be aged before credits are considered *expired* and become ineligible for transfer or retirement. |

These are declared `pub` in each contract so external callers and tooling can reference them without hardcoding magic numbers.

---

## 3. Validation Rules

### 3.1 Vintage Year Range (Creation Gate)

A vintage year is **valid for credit creation and listing** if and only if:

```
VINTAGE_YEAR_MIN ≤ vintage_year ≤ current_year + 1
```

Where `current_year` is derived from the Soroban ledger timestamp:

```rust
fn current_year(env: &Env) -> u32 {
    let seconds_per_year: u64 = 31_557_600; // Julian year
    1970 + (env.ledger().timestamp() / seconds_per_year) as u32
}
```

**Rejected values:**
- `0` through `1989` — below `VINTAGE_YEAR_MIN`
- `current_year + 2` and above — future vintages more than one year ahead are not allowed

**Allowed values:**
- `1990` through `current_year + 1` inclusive

The allowance of `current_year + 1` accommodates forward-crediting of projects whose verification period spans into the next calendar year.

### 3.2 Batch Expiry (Transfer and Retirement Gate)

A credit batch is **expired** when:

```
vintage_year + MAX_VINTAGE_AGE_YEARS < current_year
```

Equivalently: the vintage is more than 30 years old.

**Behaviour:**
- Expired credits **cannot** be retired.
- Expired credits **cannot** be transferred.
- Expired credits **can** still be minted (creation gate passes), but become immediately non-transferable if they are already past expiry at mint time. This allows historical data entry by administrators while preventing active trading.

**Boundary behaviour (inclusive):**

| vintage_year + 30 vs. current_year | Status |
|---|---|
| `vintage_year + 30 > current_year` | Valid — not expired |
| `vintage_year + 30 = current_year` | Valid — exactly at the 30-year mark, **not** expired |
| `vintage_year + 30 < current_year` | Expired |

Example at `current_year = 2026`:

| vintage_year | vintage + 30 | Expired? |
|---|---|---|
| 1993 | 2023 | Yes (2023 < 2026) |
| 1994 | 2024 | Yes (2024 < 2026) |
| 1995 | 2025 | Yes (2025 < 2026) |
| **1996** | **2026** | **No (2026 = 2026, not <)** |
| 1997 | 2027 | No |
| 2020 | 2050 | No |

---

## 4. Error Type

When vintage year validation fails, all contracts return:

```
CarbonError::InvalidVintageYear = 9
```

This single error code covers both:
- Vintage year out of the valid creation range (`< VINTAGE_YEAR_MIN` or `> current_year + 1`)
- Batch expiry at transfer or retirement time

Callers should check for error code `9` to detect any vintage year problem.

---

## 5. Enforcement Points Per Contract

### 5.1 `carbon_credit`

| Function | Check applied |
|---|---|
| `mint_credits` | Creation gate — `require_valid_vintage_year!` |
| `retire_credits` | Expiry gate — `require_batch_not_expired!` |
| `transfer_credits` | Expiry gate — `require_batch_not_expired!` |

### 5.2 `carbon_registry`

| Function | Check applied |
|---|---|
| `register_project` | Creation gate — `Self::validate_vintage_year` |
| `retire_credits` | Expiry gate — `require_batch_not_expired!` |

### 5.3 `carbon_marketplace`

| Function | Check applied |
|---|---|
| `list_credits` | Creation gate — `require_valid_vintage_year!` |
| `purchase_credits` | Creation gate + Expiry gate — `require_valid_vintage_year!` followed by `require_batch_not_expired!` |

### 5.4 `carbon_oracle`

| Function | Check applied |
|---|---|
| `update_credit_price` | Creation gate + Expiry gate — `require_valid_vintage_year!` followed by `require_batch_not_expired!` |

The oracle enforces both checks because price data for expired or invalid vintages would be meaningless and could mislead the circuit-breaker mechanism.

---

## 6. Macro Definitions

Two macros provide a uniform calling convention that prevents accidental bypass:

```rust
/// Assert vintage year is within [VINTAGE_YEAR_MIN, current_year+1].
/// Returns Err(CarbonError::InvalidVintageYear) on failure.
macro_rules! require_valid_vintage_year {
    ($env:expr, $year:expr) => {
        Self::validate_vintage_year(&$env, $year)?
    };
}

/// Assert batch is not expired (vintage_year + MAX_VINTAGE_AGE_YEARS >= current_year).
/// Returns Err(CarbonError::InvalidVintageYear) on failure.
macro_rules! require_batch_not_expired {
    ($env:expr, $year:expr) => {
        Self::validate_batch_not_expired(&$env, $year)?
    };
}
```

These macros are defined at the top of each contract file. Any code that performs a vintage year comparison directly (without going through these macros or the underlying `validate_*` functions) should be treated as a lint violation.

---

## 7. Year Calculation Notes

- The year calculation uses a **Julian year** (`31,557,600 seconds = 365.25 × 86,400`). This is a deliberate approximation — it does not track actual calendar year boundaries (Jan 1). The result can drift by up to ±1 calendar day per year relative to UTC midnight.
- The `+1` day buffer added in tests when constructing timestamps is sufficient to ensure the computed year matches the intended year for all test scenarios.
- For the purpose of expiry calculation, the Julian year approximation is adequate: a credit expiring in year `Y` will be treated as expired within a few days of January 1 of year `Y+1` at most.

---

## 8. Scope and Out-of-Scope

**In scope (implemented):**
- All 4 contracts enforce vintage year validation consistently.
- Creation gate prevents vintages before 1990 or more than 1 year in the future.
- Expiry gate prevents retiring or transferring credits older than 30 years.
- Single error code (`InvalidVintageYear = 9`) for all violations.
- Named constants (`VINTAGE_YEAR_MIN`, `MAX_VINTAGE_AGE_YEARS`) prevent magic number duplication.
- Macros ensure consistent invocation pattern.
- 90+ edge-case tests covering boundary values, century years, u32::MAX, leap-year timestamps, and expiry transitions.

**Out of scope:**
- Business policy changes to the acceptable vintage range (e.g. changing `VINTAGE_YEAR_MIN` to a different year) — requires a contract upgrade.
- Frontend date-picker validation — this is a separate concern handled at the UI layer.
- Per-methodology or per-project vintage range overrides — not currently supported.

---

## 9. Test Coverage Summary

Tests are organised into a `vintage_year_validation_tests` module in each contract's source file.

| Contract | Test module | Approximate test count |
|---|---|---|
| `carbon_credit` | `vintage_year_validation_tests` | 30+ |
| `carbon_registry` | `vintage_year_validation_tests` | 20+ |
| `carbon_marketplace` | `vintage_year_validation_tests` | 20+ |
| `carbon_oracle` | `vintage_year_validation_tests` | 20+ |

Edge cases covered include:
- Year 0, 1, 1900, 1985, 1989 (all below minimum)
- Year 1990 (minimum boundary — accepted)
- Current year, current year +1 (maximum future — accepted)
- Current year +2, far future (rejected)
- u32::MAX (overflow guard)
- Expiry boundary: `vintage + 30 = current_year` (valid), `vintage + 30 = current_year - 1` (expired)
- Century boundaries: 1999, 2000, 2001, 2099, 2100, 2101
- Ledger timestamp sensitivity (early epoch, year 2000, year 2099)
- Retire and transfer blocked for expired batches
- Multiple independent batches with different expiry states
- Constant value assertions (`VINTAGE_YEAR_MIN = 1990`, `MAX_VINTAGE_AGE_YEARS = 30`, `InvalidVintageYear = 9`)
