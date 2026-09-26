# Pause Functionality Testing Guide

> **Status:** This guide documents the proposed pause mechanism for CarbonLedger smart contracts. The pause feature is planned but not yet implemented — see [ISSUES.md](ISSUES.md) for implementation scope.

## Table of Contents

- [Overview](#overview)
- [Test Environment Setup](#test-environment-setup)
- [Unit Test Examples](#unit-test-examples)
- [Integration Test Examples](#integration-test-examples)
- [Edge Case Scenarios](#edge-case-scenarios)
- [Performance Test Guidance](#performance-test-guidance)
- [Fuzzing Strategy](#fuzzing-strategy)
- [Test Data Setup](#test-data-setup)
- [CI Integration](#ci-integration)

---

## Overview

The pause mechanism allows an authorized admin to halt all state-mutating operations across the `carbon_marketplace` and `carbon_credit` contracts in response to a security incident. Testing this feature covers three dimensions:

1. **Correctness** — paused contracts reject operations; unpaused contracts accept them.
2. **Authorization** — only the designated admin address can pause/unpause.
3. **Time-bounding** — the pause expires automatically after 72 hours without renewal.

### Affected Functions

| Contract | Function | Blocked When Paused |
|---|---|---|
| `carbon_credit` | `mint_credits` | Yes |
| `carbon_credit` | `retire_credits` | Yes |
| `carbon_credit` | `transfer_credits` | Yes |
| `carbon_marketplace` | `purchase_credits` | Yes |
| `carbon_marketplace` | `bulk_purchase` | Yes |
| `carbon_marketplace` | `list_credits` | No — listing is read-safe |
| `carbon_marketplace` | `delist_credits` | Yes |
| `carbon_registry` | All functions | No — registry is unaffected |

### New Error Code

```rust
ContractPaused = 24,  // Contract is paused; operation rejected
```

---

## Test Environment Setup

### Dependencies

Add to the contract crate's `Cargo.toml` under `[dev-dependencies]`:

```toml
[dev-dependencies]
soroban-sdk = { version = "21", features = ["testutils"] }
```

### Shared Test Helpers

Create `contracts/carbon_credit/src/test_helpers.rs`:

```rust
#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};
use crate::CarbonCreditContract;

pub struct PauseTestFixture {
    pub env: Env,
    pub contract_id: Address,
    pub admin: Address,
    pub non_admin: Address,
}

impl PauseTestFixture {
    pub fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let non_admin = Address::generate(&env);
        let contract_id = env.register_contract(None, CarbonCreditContract);

        // Initialize contract with admin
        let client = crate::CarbonCreditContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        PauseTestFixture { env, contract_id, admin, non_admin }
    }

    pub fn client(&self) -> crate::CarbonCreditContractClient {
        crate::CarbonCreditContractClient::new(&self.env, &self.contract_id)
    }

    /// Advance ledger time by `seconds`. Useful for testing pause expiry.
    pub fn advance_time(&self, seconds: u64) {
        self.env.ledger().with_mut(|l| {
            l.timestamp += seconds;
        });
    }
}
```

---

## Unit Test Examples

### Test 1 — Pause blocks `mint_credits`

```rust
#[test]
fn test_pause_blocks_minting() {
    let f = PauseTestFixture::new();
    let client = f.client();

    // Pause the contract
    client.pause(&f.admin);
    assert!(client.is_paused());

    // Attempt mint — must fail with ContractPaused
    let result = client.try_mint_credits(
        &String::from_str(&f.env, "project-1"),
        &1000_i128,
        &1,
        &1000,
        &2024_u32,
        &f.admin,
    );
    assert_eq!(
        result.unwrap_err().unwrap(),
        CarbonError::ContractPaused
    );
}
```

### Test 2 — Unpause restores `mint_credits`

```rust
#[test]
fn test_unpause_restores_minting() {
    let f = PauseTestFixture::new();
    let client = f.client();

    client.pause(&f.admin);
    client.unpause(&f.admin);
    assert!(!client.is_paused());

    // Mint should succeed after unpausing
    let result = client.try_mint_credits(
        &String::from_str(&f.env, "project-1"),
        &1000_i128,
        &1,
        &1000,
        &2024_u32,
        &f.admin,
    );
    assert!(result.is_ok());
}
```

### Test 3 — Pause blocks `retire_credits`

```rust
#[test]
fn test_pause_blocks_retirement() {
    let f = PauseTestFixture::new();
    let client = f.client();

    // Pre-condition: mint some credits
    client.mint_credits(
        &String::from_str(&f.env, "project-1"),
        &500_i128,
        &1,
        &500,
        &2024_u32,
        &f.admin,
    );

    client.pause(&f.admin);

    let result = client.try_retire_credits(
        &String::from_str(&f.env, "batch-1"),
        &100_i128,
        &f.admin,
        &String::from_str(&f.env, "ESG 2024"),
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ContractPaused);
}
```

### Test 4 — Only admin can pause

```rust
#[test]
fn test_only_admin_can_pause() {
    let f = PauseTestFixture::new();
    let client = f.client();

    let result = client.try_pause(&f.non_admin);
    assert!(result.is_err());
    assert!(!client.is_paused());
}
```

### Test 5 — Only admin can unpause

```rust
#[test]
fn test_only_admin_can_unpause() {
    let f = PauseTestFixture::new();
    let client = f.client();

    client.pause(&f.admin);
    let result = client.try_unpause(&f.non_admin);
    assert!(result.is_err());
    assert!(client.is_paused()); // still paused
}
```

### Test 6 — Pause auto-expires after 72 hours

```rust
#[test]
fn test_pause_auto_expires_after_72_hours() {
    let f = PauseTestFixture::new();
    let client = f.client();

    client.pause(&f.admin);
    assert!(client.is_paused());

    // Advance time past the 72-hour expiry window
    f.advance_time(72 * 3600 + 1);

    assert!(!client.is_paused());

    // Operations should succeed after expiry
    let result = client.try_mint_credits(
        &String::from_str(&f.env, "project-1"),
        &1000_i128,
        &1,
        &1000,
        &2024_u32,
        &f.admin,
    );
    assert!(result.is_ok());
}
```

### Test 7 — Pause renewal resets the 72-hour window

```rust
#[test]
fn test_pause_renewal_resets_expiry() {
    let f = PauseTestFixture::new();
    let client = f.client();

    client.pause(&f.admin);

    // Advance 71 hours (not yet expired), then re-pause to renew
    f.advance_time(71 * 3600);
    client.pause(&f.admin); // renewal

    // Advance another 71 hours — still within the renewed window
    f.advance_time(71 * 3600);
    assert!(client.is_paused());
}
```

### Test 8 — `is_paused` returns correct state transitions

```rust
#[test]
fn test_is_paused_state_transitions() {
    let f = PauseTestFixture::new();
    let client = f.client();

    assert!(!client.is_paused()); // initial state
    client.pause(&f.admin);
    assert!(client.is_paused());
    client.unpause(&f.admin);
    assert!(!client.is_paused());
}
```

### Test 9 — Pause emits `ContractPaused` event

```rust
#[test]
fn test_pause_emits_event() {
    let f = PauseTestFixture::new();
    let client = f.client();

    client.pause(&f.admin);

    let events = f.env.events().all();
    let pause_events: Vec<_> = events
        .iter()
        .filter(|(_, topics, _)| {
            topics.contains(&Symbol::new(&f.env, "contract_paused"))
        })
        .collect();

    assert_eq!(pause_events.len(), 1);
}
```

### Test 10 — Marketplace purchase blocked when paused

```rust
// In contracts/carbon_marketplace/src/lib.rs test module
#[test]
fn test_marketplace_purchase_blocked_when_paused() {
    // Setup: deploy both contracts, create a listing
    let env = Env::default();
    env.mock_all_auths();
    // ... setup code ...

    marketplace_client.pause(&admin);

    let result = marketplace_client.try_purchase_credits(
        &String::from_str(&env, "listing-1"),
        &100_i128,
        &buyer,
        &100_i128, // expected_amount_available
    );
    assert_eq!(result.unwrap_err().unwrap(), CarbonError::ContractPaused);
}
```

---

## Integration Test Examples

Integration tests live in `tests/` at the workspace root and spin up the full multi-contract environment.

### Test: Cross-contract pause isolation

Pausing `carbon_credit` must not affect `carbon_registry`. The registry should continue accepting project registrations while credits are paused.

```rust
// tests/pause_integration.rs

#[test]
fn test_pause_does_not_affect_registry() {
    let env = Env::default();
    env.mock_all_auths();

    let registry_id = env.register_contract(None, CarbonRegistryContract);
    let credit_id   = env.register_contract(None, CarbonCreditContract);

    let registry = CarbonRegistryContractClient::new(&env, &registry_id);
    let credit   = CarbonCreditContractClient::new(&env, &credit_id);

    let admin = Address::generate(&env);
    registry.initialize(&admin, &admin);
    credit.initialize(&admin);

    // Pause only the credit contract
    credit.pause(&admin);

    // Registry operations must still succeed
    let result = registry.try_register_project(
        &String::from_str(&env, "proj-1"),
        &String::from_str(&env, "REDD+"),
        &String::from_str(&env, "Brazil"),
        &String::from_str(&env, "Forestry"),
        &admin,
        &String::from_str(&env, "bafkrei..."),
        &80_u32,
        &2024_u32,
    );
    assert!(result.is_ok(), "Registry must not be affected by credit pause");
}
```

### Test: Pause state persists across transaction boundaries

```rust
#[test]
fn test_pause_state_is_persistent() {
    let env = Env::default();
    env.mock_all_auths();
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit = CarbonCreditContractClient::new(&env, &credit_id);
    let admin = Address::generate(&env);

    credit.initialize(&admin);
    credit.pause(&admin);

    // Re-create client (simulates a new transaction)
    let credit2 = CarbonCreditContractClient::new(&env, &credit_id);
    assert!(credit2.is_paused(), "Pause must persist in contract storage");
}
```

### Test: Unpause after expiry does not double-emit event

```rust
#[test]
fn test_unpause_after_natural_expiry_is_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit = CarbonCreditContractClient::new(&env, &credit_id);
    let admin = Address::generate(&env);

    credit.initialize(&admin);
    credit.pause(&admin);

    // Fast-forward past expiry
    env.ledger().with_mut(|l| { l.timestamp += 72 * 3600 + 1; });

    // Explicitly calling unpause on an already-expired pause should not error
    let result = credit.try_unpause(&admin);
    assert!(result.is_ok());
}
```

---

## Edge Case Scenarios

| Scenario | Expected Behavior |
|---|---|
| Pause called while already paused | Renews the 72-hour window; no error |
| Unpause called when not paused | Returns success (idempotent); no error |
| Pause expires at exactly 72:00:00 | `is_paused()` returns `false`; all operations unblocked |
| Admin calls pause, different address calls unpause | Unpause rejected unless caller is admin |
| Zero-amount operation attempted during pause | Returns `ContractPaused`, not `ZeroAmountNotAllowed` — pause check runs first |
| Pause during an in-flight bulk purchase | Transaction fails atomically; no partial state written |
| `list_credits` called while paused | Succeeds — listing is a read-safe operation |
| Read functions (`get_credit_batch`, `is_paused`) called while paused | Succeed — reads are never blocked |
| `transfer_credits` called while paused | Blocked — any state-mutation is rejected |

---

## Performance Test Guidance

Pause checks add a single storage read per state-mutating call. The performance impact is expected to be negligible (< 1 instruction unit on Soroban), but the following tests confirm this under load.

### Benchmark setup

```rust
// Measure cost of pause check overhead using Soroban's budget tracking
#[test]
fn benchmark_pause_check_overhead() {
    let env = Env::default();
    env.mock_all_auths();
    env.budget().reset_default();

    let credit_id = env.register_contract(None, CarbonCreditContract);
    let credit = CarbonCreditContractClient::new(&env, &credit_id);
    let admin = Address::generate(&env);
    credit.initialize(&admin);

    // Baseline: mint without pause
    env.budget().reset_default();
    credit.mint_credits(/* ... valid args ... */);
    let base_cpu = env.budget().cpu_instruction_count();

    // Unpause and mint again — measure the overhead introduced by pause check
    // The delta should be ≤ 500 CPU instructions
    println!("Pause check overhead: {} CPU instructions", delta);
}
```

### Load test via k6 (off-chain RPC path)

Add to `load-tests/`:

```js
// load-tests/pause-check.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  vus: 50,
  duration: '30s',
};

export default function () {
  // Simulate purchase RPC call against a paused contract
  const res = http.post(`${__ENV.RPC_URL}/soroban/rpc`, JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'simulateTransaction',
    params: { /* purchase_credits XDR */ },
  }));

  check(res, {
    'returns ContractPaused error': (r) =>
      r.json('error.data.resultXdr') !== undefined,
  });
}
```

Run with:

```bash
k6 run --env RPC_URL=https://soroban-testnet.stellar.org load-tests/pause-check.js
```

---

## Fuzzing Strategy

The pause mechanism must hold under arbitrary inputs. Use `proptest` to cover the full input space.

### Add the dependency

```toml
# contracts/carbon_credit/Cargo.toml [dev-dependencies]
proptest = { version = "1.4.0", default-features = false, features = ["std"] }
```

### Fuzz suite

```rust
#[cfg(test)]
mod fuzz_pause {
    use super::*;
    use proptest::prelude::*;
    use soroban_sdk::{testutils::Address as _, Env};

    proptest! {
        /// Any state-mutating call on a paused contract returns ContractPaused.
        #[test]
        fn fuzz_paused_contract_always_rejects_mutations(
            amount in 1_i128..=1_000_000_i128,
            vintage_year in 2000_u32..=2100_u32,
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let credit_id = env.register_contract(None, CarbonCreditContract);
            let credit = CarbonCreditContractClient::new(&env, &credit_id);
            let admin = Address::generate(&env);
            credit.initialize(&admin);
            credit.pause(&admin);

            let result = credit.try_mint_credits(
                &soroban_sdk::String::from_str(&env, "proj-fuzz"),
                &amount,
                &1,
                &amount,
                &vintage_year,
                &admin,
            );
            prop_assert_eq!(
                result.unwrap_err().unwrap(),
                CarbonError::ContractPaused
            );
        }

        /// Pause expiry is deterministic: operations always succeed after 72h + 1s.
        #[test]
        fn fuzz_pause_always_expires_after_72_hours(
            extra_seconds in 1_u64..=86_400_u64,
        ) {
            let env = Env::default();
            env.mock_all_auths();
            let credit_id = env.register_contract(None, CarbonCreditContract);
            let credit = CarbonCreditContractClient::new(&env, &credit_id);
            let admin = Address::generate(&env);
            credit.initialize(&admin);
            credit.pause(&admin);

            env.ledger().with_mut(|l| {
                l.timestamp += 72 * 3600 + extra_seconds;
            });

            prop_assert!(!credit.is_paused());
        }

        /// Random non-admin addresses can never pause the contract.
        #[test]
        fn fuzz_non_admin_cannot_pause(seed in 0_u64..=u64::MAX) {
            let env = Env::default();
            env.mock_all_auths();
            let credit_id = env.register_contract(None, CarbonCreditContract);
            let credit = CarbonCreditContractClient::new(&env, &credit_id);
            let admin = Address::generate(&env);
            credit.initialize(&admin);

            // Generate a deterministic non-admin from the seed
            let non_admin = Address::generate(&env);
            prop_assume!(non_admin != admin);

            let result = credit.try_pause(&non_admin);
            prop_assert!(result.is_err());
        }
    }
}
```

Run fuzz tests:

```bash
cd contracts
PROPTEST_CASES=1000 cargo test -p carbon_credit fuzz_pause:: -- --nocapture
PROPTEST_CASES=1000 cargo test -p carbon_marketplace fuzz_pause:: -- --nocapture
```

---

## Test Data Setup

### Minimal state for pause testing

Most pause tests require only the admin address and a deployed contract. For tests that need pre-existing credits or listings:

```rust
/// Returns a fixture with:
/// - 1 verified project ("proj-1")
/// - 1 minted batch ("batch-1", 1000 credits, vintage 2024)
/// - 1 active marketplace listing ("listing-1", 1000 credits at 12.50 USDC)
fn setup_with_listing(env: &Env) -> (Address, Address, Address) {
    // ... deploy registry, credit, marketplace contracts
    // ... mint credits
    // ... create listing
    // Returns (admin, buyer, listing_id) for use in tests
}
```

### Test accounts

| Account | Key alias | Role |
|---|---|---|
| `ADMIN` | `GADMIN...` | Contract admin, can pause/unpause |
| `BUYER` | `GBUYER...` | Regular user, cannot pause |
| `VERIFIER` | `GVERIF...` | Accredited verifier, cannot pause |
| `ORACLE` | `GORACL...` | Oracle service, cannot pause |

---

## CI Integration

Add pause tests to `.github/workflows/ci.yml`:

```yaml
- name: Run pause unit tests
  run: |
    cd contracts
    cargo test -p carbon_credit pause -- --nocapture
    cargo test -p carbon_marketplace pause -- --nocapture

- name: Run pause integration tests
  run: |
    cd contracts
    cargo test -p tests pause_integration -- --nocapture
```

Fuzz tests run on a weekly schedule (Sunday 02:00 UTC) — see the fuzz CI job in `.github/workflows/ci.yml`.

---

## Related Documentation

- [Pause Events](PAUSE_EVENTS.md) — event structures emitted during pause/unpause
- [Pause Operations Guide](PAUSE_OPERATIONS_GUIDE.md) — how admins execute a pause in production
- [Emergency Pause Runbook](runbooks/emergency-pause.md) — decision tree and checklist for security incidents
- [Error Code Reference](error-codes.md) — full list of `CarbonError` variants
- [Fuzz Tests PR](pr-fuzz-tests.md) — existing proptest suite for mint/retire/purchase
