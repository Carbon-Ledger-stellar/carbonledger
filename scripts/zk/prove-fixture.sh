#!/usr/bin/env bash
# Generate a fixture proof for circuit smoke tests / contract fixtures.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/retirement_private_cert"
ART="$CIRCUIT_DIR/artifacts"

if [[ ! -f "$ART/retirement_private_cert_final.zkey" ]]; then
  bash "$ROOT/scripts/zk/trusted-setup.sh"
fi

FIXTURE_JSON="$ART/fixture_retirement.json"
cat > "$FIXTURE_JSON" <<'EOF'
{
  "retirementId": "ret-fixture-001",
  "beneficiary": "Acme Corp Confidential",
  "amount": 12.5,
  "projectId": "proj-amazon-001",
  "serialStart": "1000",
  "serialEnd": "1125",
  "retiredBy": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
}
EOF

node "$ROOT/scripts/zk/field-encode.js" "$FIXTURE_JSON" \
  > "$ART/input.json"

echo "==> Computing witness"
node "$ART/retirement_private_cert_js/generate_witness.js" \
  "$ART/retirement_private_cert_js/retirement_private_cert.wasm" \
  "$ART/input.json" \
  "$ART/witness.wtns"

echo "==> Proving"
npx --prefix "$CIRCUIT_DIR" snarkjs groth16 prove \
  "$ART/retirement_private_cert_final.zkey" \
  "$ART/witness.wtns" \
  "$ART/proof.json" \
  "$ART/public.json"

echo "==> Verifying"
npx --prefix "$CIRCUIT_DIR" snarkjs groth16 verify \
  "$ART/verification_key.json" \
  "$ART/public.json" \
  "$ART/proof.json"

echo "OK: fixture proof at $ART/proof.json"
