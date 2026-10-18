#!/usr/bin/env bash
# generate-dependency-report.sh
#
# Formats the dependency audit artifacts into a single consolidated Markdown
# report and prints it to stdout (and optionally writes it to a file).
#
# Usage:
#   ./scripts/generate-dependency-report.sh [ARTIFACTS_DIR] [OUTPUT_FILE]
#
# Arguments:
#   ARTIFACTS_DIR   Directory containing the downloaded audit artifacts
#                   (default: ./audit-artifacts)
#   OUTPUT_FILE     Path where the Markdown report should be written
#                   (default: ./dependency-report.md)
#
# Environment variables (all optional):
#   NPM_OUTDATED_RESULT   Job result for npm-outdated  (success|failure|skipped)
#   NPM_AUDIT_RESULT      Job result for npm-security-audit
#   CARGO_AUDIT_RESULT    Job result for cargo-audit
#   PIP_AUDIT_RESULT      Job result for pip-audit
#   RUN_URL               Full URL to the GitHub Actions workflow run
#   REPORT_DATE           ISO date string (default: today)

set -euo pipefail

# ── Argument defaults ───────────────────────────────────────────────────────
ARTIFACTS_DIR="${1:-./audit-artifacts}"
OUTPUT_FILE="${2:-./dependency-report.md}"

NPM_OUTDATED_RESULT="${NPM_OUTDATED_RESULT:-unknown}"
NPM_AUDIT_RESULT="${NPM_AUDIT_RESULT:-unknown}"
CARGO_AUDIT_RESULT="${CARGO_AUDIT_RESULT:-unknown}"
PIP_AUDIT_RESULT="${PIP_AUDIT_RESULT:-unknown}"
RUN_URL="${RUN_URL:-}"
REPORT_DATE="${REPORT_DATE:-$(date -u +%Y-%m-%d)}"

# ── Helper: result → icon ───────────────────────────────────────────────────
icon() {
  case "$1" in
    success) echo "✅" ;;
    skipped) echo "⏭️" ;;
    failure) echo "❌" ;;
    *)       echo "❓" ;;
  esac
}

# ── Helper: result → label ──────────────────────────────────────────────────
label() {
  case "$1" in
    success) echo "success" ;;
    skipped) echo "skipped" ;;
    failure) echo "failure" ;;
    *)       echo "unknown" ;;
  esac
}

# ── Helper: count lines in a file (0 if missing) ────────────────────────────
line_count() {
  local file="$1"
  if [[ -f "$file" ]]; then
    wc -l < "$file" | tr -d ' '
  else
    echo "0"
  fi
}

# ── Helper: extract outdated package count from JSON ─────────────────────────
outdated_count() {
  local file="$1"
  if [[ -f "$file" ]]; then
    python3 -c "
import sys, json
try:
    d = json.load(open('$file'))
    print(len(d))
except Exception:
    print('?')
" 2>/dev/null || echo "?"
  else
    echo "0"
  fi
}

# ── Helper: extract npm audit vulnerability count ────────────────────────────
npm_vuln_count() {
  local file="$1"
  if [[ -f "$file" ]]; then
    python3 -c "
import sys, json
try:
    d = json.load(open('$file'))
    meta = d.get('metadata', {})
    vulns = meta.get('vulnerabilities', {})
    total = sum(vulns.values()) if isinstance(vulns, dict) else 0
    print(total)
except Exception:
    print('?')
" 2>/dev/null || echo "?"
  else
    echo "0"
  fi
}

# ── Determine overall status ─────────────────────────────────────────────────
all_passed=true
for result in "$NPM_OUTDATED_RESULT" "$NPM_AUDIT_RESULT" "$CARGO_AUDIT_RESULT" "$PIP_AUDIT_RESULT"; do
  if [[ "$result" != "success" && "$result" != "skipped" ]]; then
    all_passed=false
    break
  fi
done

# ── Locate artifact files ────────────────────────────────────────────────────
NPM_OUTDATED_BACKEND="${ARTIFACTS_DIR}/npm-outdated-report/npm-outdated-backend.json"
NPM_OUTDATED_FRONTEND="${ARTIFACTS_DIR}/npm-outdated-report/npm-outdated-frontend.json"
NPM_AUDIT_BACKEND_JSON="${ARTIFACTS_DIR}/npm-audit-report/npm-audit-backend.json"
NPM_AUDIT_FRONTEND_JSON="${ARTIFACTS_DIR}/npm-audit-report/npm-audit-frontend.json"
NPM_AUDIT_BACKEND_TXT="${ARTIFACTS_DIR}/npm-audit-report/npm-audit-backend.txt"
NPM_AUDIT_FRONTEND_TXT="${ARTIFACTS_DIR}/npm-audit-report/npm-audit-frontend.txt"
CARGO_AUDIT_TXT="${ARTIFACTS_DIR}/cargo-audit-report/cargo-audit.txt"
CARGO_OUTDATED_TXT="${ARTIFACTS_DIR}/cargo-audit-report/cargo-outdated.txt"
PIP_AUDIT_TXT="${ARTIFACTS_DIR}/pip-audit-report/pip-audit.txt"

# ── Count metrics ────────────────────────────────────────────────────────────
BACKEND_OUTDATED=$(outdated_count "$NPM_OUTDATED_BACKEND")
FRONTEND_OUTDATED=$(outdated_count "$NPM_OUTDATED_FRONTEND")
BACKEND_VULNS=$(npm_vuln_count "$NPM_AUDIT_BACKEND_JSON")
FRONTEND_VULNS=$(npm_vuln_count "$NPM_AUDIT_FRONTEND_JSON")
CARGO_LINES=$(line_count "$CARGO_AUDIT_TXT")
PIP_LINES=$(line_count "$PIP_AUDIT_TXT")

# ── Build report ─────────────────────────────────────────────────────────────
{
  echo "# 🗓️ Weekly Dependency Update Report — ${REPORT_DATE}"
  echo ""
  echo "**Generated:** \`${REPORT_DATE}\`  "
  if [[ -n "$RUN_URL" ]]; then
    echo "**Workflow run:** [View run](${RUN_URL})"
  fi
  echo ""
  echo "---"
  echo ""
  echo "## Summary"
  echo ""
  echo "| Check | Result | Details |"
  echo "|-------|--------|---------|"
  echo "| npm outdated (backend + frontend) | $(icon "$NPM_OUTDATED_RESULT") $(label "$NPM_OUTDATED_RESULT") | backend: ${BACKEND_OUTDATED} pkg(s), frontend: ${FRONTEND_OUTDATED} pkg(s) outdated |"
  echo "| npm security audit | $(icon "$NPM_AUDIT_RESULT") $(label "$NPM_AUDIT_RESULT") | backend: ${BACKEND_VULNS} vuln(s), frontend: ${FRONTEND_VULNS} vuln(s) |"
  echo "| cargo audit (Rust contracts) | $(icon "$CARGO_AUDIT_RESULT") $(label "$CARGO_AUDIT_RESULT") | ${CARGO_LINES} line(s) in report |"
  echo "| pip-audit (Python oracle) | $(icon "$PIP_AUDIT_RESULT") $(label "$PIP_AUDIT_RESULT") | ${PIP_LINES} line(s) in report |"
  echo ""

  if $all_passed; then
    echo "**✅ All checks passed.** No action required."
  else
    echo "**⚠️ One or more checks failed.** Review the failing checks below and update affected dependencies."
    if [[ -n "$RUN_URL" ]]; then
      echo "See the [workflow run](${RUN_URL}) for full logs."
    fi
  fi

  echo ""
  echo "---"
  echo ""

  # ── npm outdated detail ───────────────────────────────────────────────────
  echo "## npm Outdated Packages"
  echo ""
  echo "### Backend"
  if [[ -f "$NPM_OUTDATED_BACKEND" ]]; then
    python3 -c "
import json, sys
try:
    d = json.load(open('$NPM_OUTDATED_BACKEND'))
    if not d:
        print('_No outdated packages._')
    else:
        print('| Package | Current | Wanted | Latest |')
        print('|---------|---------|--------|--------|')
        for pkg, info in sorted(d.items()):
            current = info.get('current', '-')
            wanted  = info.get('wanted',  '-')
            latest  = info.get('latest',  '-')
            print(f'| \`{pkg}\` | {current} | {wanted} | {latest} |')
except Exception as e:
    print(f'_Could not parse report: {e}_')
" 2>/dev/null || echo "_Report not available._"
  else
    echo "_Report not available._"
  fi
  echo ""

  echo "### Frontend"
  if [[ -f "$NPM_OUTDATED_FRONTEND" ]]; then
    python3 -c "
import json, sys
try:
    d = json.load(open('$NPM_OUTDATED_FRONTEND'))
    if not d:
        print('_No outdated packages._')
    else:
        print('| Package | Current | Wanted | Latest |')
        print('|---------|---------|--------|--------|')
        for pkg, info in sorted(d.items()):
            current = info.get('current', '-')
            wanted  = info.get('wanted',  '-')
            latest  = info.get('latest',  '-')
            print(f'| \`{pkg}\` | {current} | {wanted} | {latest} |')
except Exception as e:
    print(f'_Could not parse report: {e}_')
" 2>/dev/null || echo "_Report not available._"
  else
    echo "_Report not available._"
  fi
  echo ""
  echo "---"
  echo ""

  # ── npm audit detail ──────────────────────────────────────────────────────
  echo "## npm Security Audit"
  echo ""
  echo "### Backend"
  if [[ -f "$NPM_AUDIT_BACKEND_TXT" ]]; then
    echo '```'
    tail -20 "$NPM_AUDIT_BACKEND_TXT"
    echo '```'
  else
    echo "_Report not available._"
  fi
  echo ""

  echo "### Frontend"
  if [[ -f "$NPM_AUDIT_FRONTEND_TXT" ]]; then
    echo '```'
    tail -20 "$NPM_AUDIT_FRONTEND_TXT"
    echo '```'
  else
    echo "_Report not available._"
  fi
  echo ""
  echo "---"
  echo ""

  # ── cargo audit detail ────────────────────────────────────────────────────
  echo "## Cargo Audit (Rust Contracts)"
  echo ""
  if [[ -f "$CARGO_AUDIT_TXT" ]]; then
    echo '```'
    cat "$CARGO_AUDIT_TXT"
    echo '```'
  else
    echo "_Report not available._"
  fi
  echo ""

  echo "### Outdated Crates"
  if [[ -f "$CARGO_OUTDATED_TXT" ]]; then
    echo '```'
    cat "$CARGO_OUTDATED_TXT"
    echo '```'
  else
    echo "_Report not available._"
  fi
  echo ""
  echo "---"
  echo ""

  # ── pip-audit detail ──────────────────────────────────────────────────────
  echo "## pip-audit (Python Oracle)"
  echo ""
  if [[ -f "$PIP_AUDIT_TXT" ]]; then
    cat "$PIP_AUDIT_TXT"
  else
    echo "_Report not available._"
  fi
  echo ""
  echo "---"
  echo ""

  echo "_Report generated by \`scripts/generate-dependency-report.sh\`. Dependabot will open PRs automatically for patched versions._"

} > "$OUTPUT_FILE"

echo "Report written to: $OUTPUT_FILE"
cat "$OUTPUT_FILE"
