#!/usr/bin/env bash
# Generate a private retirement certificate proof.
#
# Usage:
#   ./scripts/generate-retirement-proof.sh --retirement-id <id> --secret <S|@path>
#   ./scripts/generate-retirement-proof.sh --witness.json path/to/record.json
#
# Env:
#   API_BASE_URL   default http://localhost:3001/api/v1
#   AUTH_TOKEN     Bearer JWT (when fetching from API)
#   OUT_DIR        default ./zk-out/<retirementId>
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUIT_DIR="$ROOT/circuits/retirement_private_cert"
ART="$CIRCUIT_DIR/artifacts"
API_BASE_URL="${API_BASE_URL:-http://localhost:3001/api/v1}"

RETIREMENT_ID=""
SECRET=""
WITNESS_JSON=""

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --retirement-id) RETIREMENT_ID="$2"; shift 2 ;;
    --secret) SECRET="$2"; shift 2 ;;
    --witness.json|--witness-json) WITNESS_JSON="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1" >&2; usage ;;
  esac
done

if [[ -n "$SECRET" && "$SECRET" == @* ]]; then
  SECRET="$(cat "${SECRET:1}")"
fi

RECORD_JSON=""
TMPDIR_CREATED=""
cleanup() {
  if [[ -n "$TMPDIR_CREATED" && -d "$TMPDIR_CREATED" ]]; then
    rm -rf "$TMPDIR_CREATED"
  fi
}
trap cleanup EXIT

if [[ -n "$WITNESS_JSON" ]]; then
  RECORD_JSON="$WITNESS_JSON"
  RETIREMENT_ID="${RETIREMENT_ID:-$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).retirementId||'local')" "$WITNESS_JSON")}"
elif [[ -n "$RETIREMENT_ID" ]]; then
  if [[ -z "$SECRET" && -z "${AUTH_TOKEN:-}" ]]; then
    echo "ERROR: provide --secret or AUTH_TOKEN to fetch retirement $RETIREMENT_ID" >&2
    exit 1
  fi
  TMPDIR_CREATED="$(mktemp -d)"
  RECORD_JSON="$TMPDIR_CREATED/retirement.json"
  HDRS=(-H "Accept: application/json")
  if [[ -n "${AUTH_TOKEN:-}" ]]; then
    HDRS+=(-H "Authorization: Bearer $AUTH_TOKEN")
  fi
  # Wallet secret is used only for local auth handshake stubs / future signing.
  # Never printed. Existence check only.
  if [[ -n "$SECRET" ]]; then
    : # reserved for wallet-derived auth; keep off stdout
  fi
  curl -fsS "${HDRS[@]}" "$API_BASE_URL/retirements/$RETIREMENT_ID" -o "$RECORD_JSON"
else
  usage
fi

OUT_DIR="${OUT_DIR:-$ROOT/zk-out/$RETIREMENT_ID}"
mkdir -p "$OUT_DIR"

if [[ ! -f "$ART/retirement_private_cert_final.zkey" ]]; then
  echo "ERROR: missing zkey. Run: bash scripts/zk/trusted-setup.sh" >&2
  exit 1
fi

INPUT_JSON="$OUT_DIR/input.json"
node "$ROOT/scripts/zk/field-encode.js" "$RECORD_JSON" > "$INPUT_JSON"

# Confirm wallet binding hash without revealing beneficiary
node -e '
const crypto=require("crypto");
const fs=require("fs");
const rec=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const h=crypto.createHash("sha256").update(String(rec.retiredBy||""),"utf8").digest("hex").slice(0,16);
console.error("Proving for retiredByHashPrefix="+h+" (beneficiary omitted from stdout)");
' "$RECORD_JSON"

node "$ART/retirement_private_cert_js/generate_witness.js" \
  "$ART/retirement_private_cert_js/retirement_private_cert.wasm" \
  "$INPUT_JSON" \
  "$OUT_DIR/witness.wtns"

npx --prefix "$CIRCUIT_DIR" snarkjs groth16 prove \
  "$ART/retirement_private_cert_final.zkey" \
  "$OUT_DIR/witness.wtns" \
  "$OUT_DIR/proof.json" \
  "$OUT_DIR/public.json"

# Soroban-ready bundle (JSON; hex conversion helpers live in contract tests)
node -e '
const fs=require("fs");
const out=process.argv[1];
const proof=JSON.parse(fs.readFileSync(out+"/proof.json","utf8"));
const pub=JSON.parse(fs.readFileSync(out+"/public.json","utf8"));
const cert={
  scheme:"groth16-bls12-381",
  circuit:"retirement_private_cert",
  publicSignals:{
    beneficiaryCommitment: pub[0],
    nullifier: pub[1],
    retiredByHash: pub[2],
  },
  proof,
  warning:"Dev artifacts must not be used on mainnet without a production ceremony.",
};
fs.writeFileSync(out+"/private_certificate.json", JSON.stringify(cert,null,2));
console.log(out+"/private_certificate.json");
' "$OUT_DIR"

# Scrub witness inputs that embed hashed PII encodings from default listing
chmod 600 "$INPUT_JSON" "$OUT_DIR/witness.wtns" 2>/dev/null || true
echo "Wrote proof bundle under $OUT_DIR (beneficiary not printed)."
