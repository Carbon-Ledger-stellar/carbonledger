#!/usr/bin/env bash
# Compile retirement_private_cert for BLS12-381 (Soroban-compatible).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/retirement_private_cert"
ART="$CIRCUIT_DIR/artifacts"
mkdir -p "$ART"

CIRCOM_BIN="${CIRCOM_BIN:-$(command -v circom || true)}"
if [[ -z "$CIRCOM_BIN" ]]; then
  echo "ERROR: circom not found. Install via: cargo install --git https://github.com/iden3/circom.git --tag v2.2.2 circom" >&2
  exit 1
fi

cd "$CIRCUIT_DIR"
if [[ ! -d node_modules/circomlib ]]; then
  npm install
fi

echo "==> Compiling with BLS12-381 prime (-p bls12381)"
"$CIRCOM_BIN" retirement_private_cert.circom \
  --r1cs --wasm --sym \
  -p bls12381 \
  -o "$ART"

echo "==> Circuit info"
npx snarkjs r1cs info "$ART/retirement_private_cert.r1cs"
echo "OK: artifacts in $ART"
