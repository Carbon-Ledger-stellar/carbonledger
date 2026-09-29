#!/usr/bin/env bash
# =============================================================================
# setup-kibana-pause-dashboards.sh
#
# Idempotent script to import pause event Kibana dashboards and configure
# the carbonledger-pause-* index pattern and ILM policy in Elasticsearch.
#
# Run once after the ELK stack starts, or re-run to refresh dashboards.
# Safe to run multiple times — uses _create_or_update semantics.
#
# Usage:
#   KIBANA_URL=http://kibana:5601 ELASTICSEARCH_URL=http://elasticsearch:9200 ./setup-kibana-pause-dashboards.sh
# =============================================================================

set -euo pipefail

KIBANA_URL="${KIBANA_URL:-http://localhost:5601}"
ES_URL="${ELASTICSEARCH_URL:-http://localhost:9200}"
ES_USER="${ELASTICSEARCH_USER:-}"
ES_PASS="${ELASTICSEARCH_PASSWORD:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$(dirname "$SCRIPT_DIR")"

# Auth header helper
auth_args=()
if [[ -n "$ES_USER" && -n "$ES_PASS" ]]; then
  auth_args=(-u "${ES_USER}:${ES_PASS}")
fi

echo "===== CarbonLedger — Kibana Pause Dashboard Setup ====="
echo "Kibana:        $KIBANA_URL"
echo "Elasticsearch: $ES_URL"
echo ""

# ── 1. Wait for Elasticsearch ─────────────────────────────────────────────────
echo "[1/5] Waiting for Elasticsearch..."
for i in $(seq 1 30); do
  if curl -sf "${auth_args[@]}" "$ES_URL/_cluster/health" > /dev/null 2>&1; then
    echo "       Elasticsearch is ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "       ERROR: Elasticsearch did not become ready in 5 minutes." >&2
    exit 1
  fi
  echo "       Attempt $i/30 — retrying in 10s..."
  sleep 10
done

# ── 2. Apply ILM policy ────────────────────────────────────────────────────────
echo "[2/5] Applying ILM policy (carbonledger-pause-policy)..."
curl -sf "${auth_args[@]}" \
  -X PUT "$ES_URL/_ilm/policy/carbonledger-pause-policy" \
  -H "Content-Type: application/json" \
  -d @"$LOG_DIR/logstash/ilm-pause-policy.json" \
  | python3 -m json.tool --no-ensure-ascii 2>/dev/null || true
echo ""

# ── 3. Apply index template ────────────────────────────────────────────────────
echo "[3/5] Applying index template (carbonledger-pause)..."
curl -sf "${auth_args[@]}" \
  -X PUT "$ES_URL/_index_template/carbonledger-pause" \
  -H "Content-Type: application/json" \
  -d @"$LOG_DIR/logstash/templates/carbonledger-pause.json" \
  | python3 -m json.tool --no-ensure-ascii 2>/dev/null || true
echo ""

# ── 4. Wait for Kibana ────────────────────────────────────────────────────────
echo "[4/5] Waiting for Kibana..."
for i in $(seq 1 30); do
  if curl -sf "$KIBANA_URL/api/status" > /dev/null 2>&1; then
    echo "       Kibana is ready."
    break
  fi
  if [[ $i -eq 30 ]]; then
    echo "       ERROR: Kibana did not become ready in 5 minutes." >&2
    exit 1
  fi
  echo "       Attempt $i/30 — retrying in 10s..."
  sleep 10
done

# ── 5. Import Kibana saved objects ────────────────────────────────────────────
echo "[5/5] Importing Kibana dashboards and index patterns..."
NDJSON_FILE="$LOG_DIR/kibana/dashboards/pause-events.ndjson"

if [[ ! -f "$NDJSON_FILE" ]]; then
  echo "       ERROR: $NDJSON_FILE not found." >&2
  exit 1
fi

HTTP_STATUS=$(curl -s -o /tmp/kibana_import_response.json -w "%{http_code}" \
  -X POST "$KIBANA_URL/api/saved_objects/_import?overwrite=true" \
  -H "kbn-xsrf: true" \
  -F "file=@$NDJSON_FILE;type=application/json")

if [[ "$HTTP_STATUS" -ge 200 && "$HTTP_STATUS" -lt 300 ]]; then
  echo "       Import successful (HTTP $HTTP_STATUS)."
  if command -v python3 &>/dev/null; then
    python3 -m json.tool /tmp/kibana_import_response.json 2>/dev/null || cat /tmp/kibana_import_response.json
  else
    cat /tmp/kibana_import_response.json
  fi
else
  echo "       WARNING: Import returned HTTP $HTTP_STATUS." >&2
  cat /tmp/kibana_import_response.json >&2
fi

echo ""
echo "===== Setup complete ====="
echo "Kibana Dashboard: $KIBANA_URL/app/dashboards"
echo "Index pattern:    carbonledger-pause-*"
echo "Audit search:     $KIBANA_URL/app/discover#/?_g=(filters:!())&_a=(index:'carbonledger-pause-index-pattern')"
