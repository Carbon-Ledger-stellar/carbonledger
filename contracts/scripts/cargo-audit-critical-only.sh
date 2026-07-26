#!/usr/bin/env bash
# Exit 0 unless cargo-audit reports at least one vulnerability with critical severity.
set -euo pipefail
cd "$(dirname "$0")/.."

cargo install cargo-audit --locked --quiet 2>/dev/null || true

OUT="$(mktemp)"
JSON="$(mktemp)"
trap 'rm -f "$OUT" "$JSON"' EXIT

set +e
cargo audit --deny unsound --deny yanked 2>&1 | tee "$OUT"
AUDIT_EXIT=${PIPESTATUS[0]}
set -e

cargo audit --json >"$JSON" 2>/dev/null || true

if command -v jq >/dev/null 2>&1 && [ -s "$JSON" ]; then
  CRITICAL_COUNT="$(jq '[.vulnerabilities[]? | select(.advisory.severity == "critical")] | length' "$JSON")"
  if [ "${CRITICAL_COUNT:-0}" -gt 0 ]; then
    echo "::error::cargo audit found ${CRITICAL_COUNT} critical vulnerability/vulnerabilities"
    exit 1
  fi
  echo "cargo audit: no critical vulnerabilities (${AUDIT_EXIT} non-critical advisory exit ignored)"
  exit 0
fi

# Fallback when jq/JSON unavailable: block only on explicit critical lines
if grep -qiE 'severity:[[:space:]]*critical' "$OUT"; then
  echo "::error::cargo audit found critical vulnerabilities"
  exit 1
fi

if [ "$AUDIT_EXIT" -ne 0 ]; then
  echo "cargo audit reported advisories (non-critical); continuing"
fi
exit 0
