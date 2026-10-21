#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/carbonledger/pause_events}"
TIMESTAMP="$(date -u +"%Y%m%d_%H%M%S")"
OUTPUT_FILE="${BACKUP_DIR}/pause_events_${TIMESTAMP}.json"

mkdir -p "${BACKUP_DIR}"

echo "[INFO] Starting pause events and audit trail backup at $(date -u)"

# Export pause audit logs
if command -v psql &> /dev/null && [ -n "${DATABASE_URL:-}" ]; then
  psql "${DATABASE_URL}" -c "COPY (SELECT * FROM audit_logs WHERE action LIKE '%pause%' ORDER BY created_at DESC) TO STDOUT WITH (FORMAT json);" > "${OUTPUT_FILE}"
else
  echo '{"status": "simulated_backup", "timestamp": "'"${TIMESTAMP}"'", "events": []}' > "${OUTPUT_FILE}"
fi

sha256sum "${OUTPUT_FILE}" > "${OUTPUT_FILE}.sha256"
echo "[INFO] Backup written to ${OUTPUT_FILE} with SHA256 verification"
