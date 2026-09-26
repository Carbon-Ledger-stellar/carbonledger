# Smart Contract Development Guide

This guide covers building, testing, and deploying the CarbonLedger Soroban contracts. The examples use the `carbon_credit` contract and Stellar Testnet.

## Prerequisites

Install the following before working in this repository:

- Rust via [rustup](https://rustup.rs/)
- The `wasm32-unknown-unknown` Rust target
- The [Stellar CLI](https://developers.stellar.org/docs/tools/stellar-cli)
- A funded Stellar Testnet account
- Git

Verify the tools and target:

```bash
rustc --version
cargo --version
stellar --version
rustup target list --installed | grep wasm32-unknown-unknown
```

From the repository root, install the target if necessary:

```bash
rustup target add wasm32-unknown-unknown
```

Do not commit secret keys. Use the Stellar CLI key store or environment variables for signing accounts.

## Project Structure

```text
contracts/
├── Cargo.toml                 # Rust workspace and shared dependencies
├── rust-toolchain.toml        # Repository Rust toolchain
├── carbon_credit/              # Credit batches, ownership, minting, retirement
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs              # Contract entry points and unit tests
│       ├── conservation.rs    # Supply conservation data and checks
│       ├── invariants.rs      # Invariant tests
│       ├── proofs.rs          # Bounded correctness proofs
│       └── serial_index.rs     # Serial-range collision prevention
├── carbon_registry/            # Project registration and verification
├── carbon_marketplace/         # Listings and marketplace operations
├── carbon_oracle/              # Oracle data and freshness checks
├── carbon_zk_verifier/         # Zero-knowledge proof verification
└── adversarial_tests/          # Cross-contract and security-focused tests
```

The workspace is declared in `contracts/Cargo.toml`. Each contract is a separate Rust crate and produces a WebAssembly artifact for Soroban deployment.

## Configure the Stellar CLI

Create a Testnet identity. Choose an alias that is meaningful on your machine:

```bash
stellar keys generate carbonledger-admin --network testnet
stellar keys address carbonledger-admin
```

Fund the account with the [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=test) or another Testnet funding method. Confirm the account has a balance before deploying.

If the Testnet network is not already configured, add it using the current Stellar Testnet RPC endpoint and passphrase:

```bash
stellar network add testnet \
  --rpc-url https://soroban-testnet.stellar.org:443 \
  --network-passphrase "Test SDF Network ; September 2015"
```

List configured networks and accounts:

```bash
stellar network ls
stellar keys ls
```

## Build Contracts

Build all workspace members from the `contracts` directory:

```bash
cd contracts
cargo build --workspace --target wasm32-unknown-unknown --release
```

Build only the carbon credit contract:

```bash
cargo build -p carbon_credit --target wasm32-unknown-unknown --release
```

The WebAssembly artifact is created at:

```text
target/wasm32-unknown-unknown/release/carbon_credit.wasm
```

A release build is the artifact to deploy. Rebuild after changing contract code and verify that the expected `.wasm` file exists before deployment.

## Test Contracts

Run the workspace's Rust tests from `contracts`:

```bash
cargo test --workspace
```

Run only the carbon credit tests:

```bash
cargo test -p carbon_credit
```

Run a focused test by name and show its output:

```bash
cargo test -p carbon_credit test_mint_credits_success -- --nocapture
```

The contract test suite uses Soroban SDK test utilities and does not require a live network. Tests should cover authorization, paused state, invalid amounts, vintage-year validation, serial-range overlap, conservation, and retirement behavior.

## Deploy to Testnet

Build the contract first, then deploy it with the admin identity:

```bash
cd contracts
cargo build -p carbon_credit --target wasm32-unknown-unknown --release

stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/carbon_credit.wasm \
  --source-account carbonledger-admin \
  --network testnet \
  --alias carbon-credit-testnet
```

The command prints the deployed contract ID. Store it in a local, uncommitted environment file or deployment secret manager:

```bash
export CARBON_CREDIT_CONTRACT_ID=CARBON_CREDIT_CONTRACT_ID_FROM_DEPLOY_OUTPUT
```

Replace the placeholder above with the actual 56-character contract ID. Never put a secret key in source control. The contract IDs in `Stellar.toml` are deployment placeholders until a deployment is completed.

For additional contracts, repeat the build and deploy steps with the corresponding package and artifact names:

```bash
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/carbon_registry.wasm --source-account carbonledger-admin --network testnet --alias carbon-registry-testnet
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/carbon_marketplace.wasm --source-account carbonledger-admin --network testnet --alias carbon-marketplace-testnet
stellar contract deploy --wasm target/wasm32-unknown-unknown/release/carbon_oracle.wasm --source-account carbonledger-admin --network testnet --alias carbon-oracle-testnet
```

Keep the deployed IDs and initialization order in the deployment record. Initialize dependencies before invoking methods that require their addresses.

## Example: Mint 100 Credits

The CarbonLedger contract exposes `mint_credits`; there is no public method named `mint`. The method requires an authenticated admin and these arguments:

| Argument | Example | Purpose |
| --- | --- | --- |
| `admin` | `G...` | Contract admin and transaction signer |
| `project_id` | `project-amazon-001` | Existing project identifier |
| `amount` | `100` | Number of credits to mint |
| `vintage_year` | `2024` | Valid vintage year for the contract ledger |
| `batch_id` | `batch-amazon-2024-001` | Unique batch identifier |
| `serial_start` | `1000001` | First serial in the inclusive range |
| `serial_end` | `1000101` | End boundary; it must be greater than `serial_start` |
| `metadata_cid` | `bafy...` | Non-empty metadata content identifier |
| `initial_owner` | `G...` | Account receiving the minted batch |

Because the serial range is represented by its start and end boundaries, a 100-credit range uses `serial_end = serial_start + 100`.

Set public keys in the shell rather than editing the command repeatedly:

```bash
export ADMIN_ADDRESS=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
export OWNER_ADDRESS=GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY
export CARBON_CREDIT_CONTRACT_ID=CARBON_CREDIT_CONTRACT_ID_FROM_DEPLOY_OUTPUT
```

Invoke the contract on Testnet:

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --source-account carbonledger-admin \
  --network testnet \
  -- \
  mint_credits \
  --admin "$ADMIN_ADDRESS" \
  --project_id project-amazon-001 \
  --amount 100 \
  --vintage_year 2024 \
  --batch_id batch-amazon-2024-001 \
  --serial_start 1000001 \
  --serial_end 1000101 \
  --metadata_cid bafybeigdyr-example-carbon-metadata \
  --initial_owner "$OWNER_ADDRESS"
```

The invocation succeeds only when the signer is the configured admin, the contract is not paused, the project and batch values meet their length rules, the vintage year is valid, and no existing batch uses the serial range. Record the transaction hash and batch ID for verification.

## Verify a Deployment

Use the contract alias or ID to inspect the deployed contract and invoke read-only methods exposed by that contract:

```bash
stellar contract invoke \
  --id "$CARBON_CREDIT_CONTRACT_ID" \
  --network testnet \
  -- \
  get_credit_batch \
  --batch_id batch-amazon-2024-001
```

If the contract exposes a different read method in the current revision, list or inspect its generated bindings and use that method name. Confirm the transaction and contract ID in a Testnet explorer before sharing them.

## Troubleshooting

### `wasm32-unknown-unknown` target is missing

Install it and rebuild:

```bash
rustup target add wasm32-unknown-unknown
cargo build -p carbon_credit --target wasm32-unknown-unknown --release
```

### `stellar` command is not found

Install the Stellar CLI from the official Stellar documentation, then open a new shell and verify `stellar --version`. Ensure the installation directory is on `PATH`.

### Transaction fails with authorization or admin errors

The `admin` argument must be the configured contract administrator, and that address must authorize the transaction. Ensure `--source-account` resolves to the matching key alias and that the account is funded.

### Transaction fails with an invalid serial range

`serial_start` must be non-zero and `serial_end` must be greater than `serial_start`. For 100 credits, use a range with a difference of 100 and ensure it does not overlap any previously minted range.

### Transaction fails with a duplicate batch or serial conflict

Use a new `batch_id` and an unused serial range. Do not retry blindly: inspect the previous transaction first so a successful submission is not duplicated.

### Transaction fails with vintage validation

Use a vintage year accepted by the deployed contract and confirm the Testnet ledger date. Contract validation rules can change between deployments, so match the deployed WASM revision.

### Deployment runs out of funds or fails during simulation

Fund the Testnet source account, rebuild with `--release`, and check the CLI output for the simulation error. Large or repeated deployments may need additional Testnet XLM for fees and rent.

### The contract ID is missing from project configuration

Deployment IDs are intentionally placeholders in `Stellar.toml`. Update deployment configuration through the project’s normal release process; do not replace placeholders with local secrets or unverified addresses.

## Further Reading

- [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts)
- [Stellar CLI documentation](https://developers.stellar.org/docs/tools/stellar-cli)
- [CarbonLedger contract workspace](../contracts/Cargo.toml)
- [Oracle testing guide](testing-guide.md)
