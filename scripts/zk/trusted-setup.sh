#!/usr/bin/env bash
# Dev-only Groth16 trusted setup for BLS12-381.
# DO NOT USE THESE ARTIFACTS ON MAINNET — single-contributor ceremony.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/retirement_private_cert"
ART="$CIRCUIT_DIR/artifacts"
mkdir -p "$ART"

cd "$CIRCUIT_DIR"
if [[ ! -f "$ART/retirement_private_cert.r1cs" ]]; then
  bash "$ROOT/scripts/zk/compile-circuit.sh"
fi

PTAU="$ART/pot14_final.ptau"
if [[ ! -f "$PTAU" ]]; then
  echo "==> Powers of Tau (bls12381, power 14) — DEV ONLY"
  npx snarkjs powersoftau new bls12381 14 "$ART/pot14_0000.ptau" -v
  npx snarkjs powersoftau contribute "$ART/pot14_0000.ptau" "$ART/pot14_0001.ptau" \
    --name="carbonledger-dev" -e="dev-entropy-$(date +%s)" -v
  npx snarkjs powersoftau prepare phase2 "$ART/pot14_0001.ptau" "$PTAU" -v
  rm -f "$ART/pot14_0000.ptau" "$ART/pot14_0001.ptau"
fi

echo "==> Groth16 setup + contribute"
npx snarkjs groth16 setup \
  "$ART/retirement_private_cert.r1cs" \
  "$PTAU" \
  "$ART/retirement_private_cert_0000.zkey"

npx snarkjs zkey contribute \
  "$ART/retirement_private_cert_0000.zkey" \
  "$ART/retirement_private_cert_final.zkey" \
  --name="carbonledger-dev-zkey" \
  -e="dev-zkey-entropy-$(date +%s)"

npx snarkjs zkey export verificationkey \
  "$ART/retirement_private_cert_final.zkey" \
  "$ART/verification_key.json"

rm -f "$ART/retirement_private_cert_0000.zkey"

cat > "$ART/DEV_TRUSTED_SETUP_WARNING.md" <<'EOF'
# DO NOT USE ON MAINNET

These `.ptau` / `.zkey` / `verification_key.json` artifacts were produced by a
**single-contributor** development ceremony. They provide no toxic-waste
security guarantees.

Production deployments MUST run a multi-party trusted setup (or use a
ceremony with publicly audited transcripts) before embedding the VK in
`carbon_zk_verifier`.
EOF

echo "OK: zkey + verification_key.json written to $ART"
