# Oracle Testing Guide

## Overview

This guide documents the testing infrastructure for the oracle bridge, including
property-based tests using proptest (Rust) and hypothesis (Python).

## Running Tests

### Unit Tests

```bash
# Python oracle tests
cd oracle
pytest test_*.py -v

# Rust contract tests
cd contracts
cargo test -p carbon_oracle
```

### Property-Based Tests

#### Proptest (Rust — carbon_oracle)

Proptest tests are located in `contracts/carbon_oracle/src/lib.rs` under the
`proptest_price_tests` module. They cover TWAP calculation correctness, deviation
alert triggering, and price submission rejection.

Run proptest tests:

```bash
cd contracts
cargo test -p carbon_oracle 'proptest_price_tests::' -- --nocapture
```

To run with a custom number of cases:

```bash
PROPTEST_CASES=10000 cargo test -p carbon_oracle 'proptest_price_tests::' -- --nocapture
```

#### Hypothesis (Python — price_oracle.py)

Hypothesis tests are located in `tests/fuzz/oracle/test_hypothesis_price_oracle.py`.
They cover TWAP math, deviation logic, and price validation.

Run hypothesis tests:

```bash
cd oracle
pip install -r requirements.txt -r requirements-dev.txt
pytest tests/fuzz/oracle/test_hypothesis_price_oracle.py -v
```

### CI Integration

Property-based tests run automatically in CI:

- Hypothesis tests run on every PR via the `CI` workflow.
- Proptest tests run on a schedule via the `fuzz` workflow.

## Property-Based Test Properties

### TWAP Properties (proptest + hypothesis)

| Property | Invariant |
|----------|-----------|
| P1 | TWAP is always within the min and max of the price history |
| P2 | TWAP with a single price equals that price |
| P3 | TWAP with constant prices equals that constant |
| P6 | TWAP is monotonic with respect to adding a price within range |
| P7 | Deviation is zero when current price equals reference price |

### Deviation Alert Properties

| Property | Invariant |
|----------|-----------|
| P4 | Deviation alert triggers when price exceeds threshold |

### Price Rejection Properties

| Property | Invariant |
|----------|-----------|
| P5 | Out-of-range prices (NaN, Inf, negative, zero) are rejected |

## Counterexamples Found During Development

During development of the proptest suite, the following counterexample was found:

- **P1 (TWAP within min/max)**: When the price history contains entries with
  zero duration, the TWAP calculation could produce a value outside the min-max
  range due to division by zero in the weight calculation. This was fixed by
  adding a guard for `total_duration <= 0`.

- **P5 (Out-of-range rejection)**: The initial implementation did not reject
  `NaN` prices because `NaN <= 0` evaluates to `False` in Python. This was
  fixed by adding an explicit `math.isfinite()` check before the range check.

## Test Environment

### Required Environment Variables

```bash
export ORACLE_SECRET_KEY=SDUMMYKEYFORTEST0000000000000000000000000000000000000
export CARBON_ORACLE_CONTRACT_ID=CA... (56 chars)
export CARBON_REGISTRY_CONTRACT_ID=CB... (56 chars)
```

### Dependencies

```bash
# Python
pip install -r oracle/requirements.txt
pip install -r oracle/requirements-dev.txt

# Rust (for proptest)
rustup default 1.86.0
rustup target add wasm32-unknown-unknown
```

## Adding New Properties

When adding new property-based tests:

1. Add the property function with a descriptive name prefixed with `prop_`.
2. Comment the business invariant the property represents.
3. Use `proptest_config` to set the number of cases (default: 1000).
4. Run the test locally before committing.
5. Document any counterexamples found in this guide.