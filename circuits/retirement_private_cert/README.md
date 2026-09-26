# Retirement Private Certificate Circuit

Circom 2 + snarkjs Groth16 over **BLS12-381** for Carbon Ledger private
retirement certificates. See `docs/zk-proof-spec.md`.

## Build

```bash
# requires: circom 2.2+, node/npm
npm install
bash ../../scripts/zk/compile-circuit.sh
bash ../../scripts/zk/trusted-setup.sh   # DEV ONLY ceremony
bash ../../scripts/zk/prove-fixture.sh
```

## Warning

`artifacts/` zkeys from the setup script are **not** mainnet-safe. Read
`artifacts/DEV_TRUSTED_SETUP_WARNING.md` and
`docs/zk-proof-security-analysis.md`.
