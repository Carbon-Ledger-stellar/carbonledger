#!/usr/bin/env python3
"""
scripts/run_perf_benchmarks.py

Unified performance regression tracker for CarbonLedger (#1056).

Collects metrics from all three dimensions:
  1. Contract  — Soroban cpu_instructions (via cargo test benchmarks)
  2. API       — HTTP response time percentiles (p50/p95/p99)
  3. DB        — Query execution time percentiles (p50/p95/p99)

Compares each metric against benchmarks/baseline.json.
Fails (exit 1) if any metric regresses by more than REGRESSION_THRESHOLD_PCT (10%).

Writes:
  benchmarks/current.json       — latest unified snapshot (uploaded as artifact)
  benchmark-report.md           — markdown regression report (posted to job summary)

Appends to:
  benchmarks/history.csv        — one row per run; used for trend analysis

Usage:
    # Full run (contract + API + DB):
    python3 scripts/run_perf_benchmarks.py --run

    # Skip contract benchmarks (no Rust toolchain available):
    python3 scripts/run_perf_benchmarks.py --run --skip-contract

    # Use pre-captured contract log + live API/DB:
    python3 scripts/run_perf_benchmarks.py --contract-log /tmp/bench.log

    # Regression check only (compare existing current.json against baseline):
    python3 scripts/run_perf_benchmarks.py --compare-only

Environment variables (all optional):
    PERF_API_URL       API base URL          (default: http://localhost:3001/api/v1)
    PERF_API_RAW_URL   Raw server URL        (default: http://localhost:3001)
    DATABASE_URL       PostgreSQL DSN for direct DB benchmarking
    BENCH_SAMPLES      Requests per endpoint (default: 50)
    BENCH_WARMUP       Warmup requests       (default: 5)
    GITHUB_SHA         Git SHA to embed in history.csv
    GITHUB_REF_NAME    Branch/tag name to embed in history.csv

Closes #1056
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import statistics
import subprocess
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── Constants ──────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = REPO_ROOT / "contracts"
BENCHMARKS_DIR = REPO_ROOT / "benchmarks"
BASELINE_PATH = BENCHMARKS_DIR / "baseline.json"
CURRENT_PATH = BENCHMARKS_DIR / "current.json"
HISTORY_PATH = BENCHMARKS_DIR / "history.csv"

BENCHMARKED_CRATES = ["carbon_credit", "carbon_marketplace"]
BENCH_LINE_RE = re.compile(r"^BENCH_RESULT (\{.*\})\s*$")

REGRESSION_THRESHOLD_PCT = 10.0

# For API/DB, we gate on p95 (the practical latency SLO metric).
# Contract gates on cpu_instructions (the binding Soroban resource).
API_GATE_METRIC = "p95_ms"
DB_GATE_METRIC = "p95_ms"

REPORT_PATH = REPO_ROOT / "benchmark-report.md"

# ── Helpers ────────────────────────────────────────────────────────────────────

def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        print(f"WARNING: could not parse {path}: {exc}", file=sys.stderr)
        return {}


def percentile(sorted_data: list[float], pct: float) -> float:
    if not sorted_data:
        return 0.0
    k = max(0, min(len(sorted_data) - 1, int(round(pct / 100.0 * len(sorted_data))) - 1))
    return sorted_data[k]


def _measure_http(
    method: str, url: str, samples: int, warmup: int, timeout: float
) -> list[float]:
    durations: list[float] = []
    body = b'{"listingId":"bench-probe","amount":1}' if method == "POST" else None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    for i in range(warmup + samples):
        t0 = time.perf_counter()
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=timeout):
                pass
        except urllib.error.HTTPError:
            pass
        except (urllib.error.URLError, OSError) as exc:
            print(f"    request error: {exc}", file=sys.stderr)
            continue
        if i >= warmup:
            durations.append((time.perf_counter() - t0) * 1000.0)
    return durations


def _summarize(durations: list[float], label: str, metric_key: str = "p95_ms") -> dict:
    if not durations:
        return {metric_key: None, "p50_ms": None, "p99_ms": None, "samples": 0, "error": "all requests failed"}
    s = sorted(durations)
    return {
        "p50_ms": round(percentile(s, 50), 2),
        "p95_ms": round(percentile(s, 95), 2),
        "p99_ms": round(percentile(s, 99), 2),
        "mean_ms": round(statistics.mean(durations), 2),
        "min_ms": round(s[0], 2),
        "max_ms": round(s[-1], 2),
        "samples": len(durations),
    }


# ── 1. Contract benchmarks ─────────────────────────────────────────────────────

def run_contract_benchmarks() -> str:
    output_parts = []
    for crate in BENCHMARKED_CRATES:
        result = subprocess.run(
            ["cargo", "test", "-p", crate, "--test", "benchmarks", "--", "--nocapture"],
            cwd=CONTRACTS_DIR,
            capture_output=True,
            text=True,
        )
        output_parts.append(result.stdout)
        output_parts.append(result.stderr)
        if result.returncode != 0:
            print(f"ERROR: benchmark tests failed for {crate}:\n{result.stdout}\n{result.stderr}", file=sys.stderr)
            sys.exit(1)
    return "\n".join(output_parts)


def parse_contract_results(log_text: str) -> dict[str, dict]:
    results: dict[str, dict] = {}
    for line in log_text.splitlines():
        m = BENCH_LINE_RE.match(line.strip())
        if not m:
            continue
        record = json.loads(m.group(1))
        results[record["function"]] = record
    return results


# ── 2. API benchmarks ──────────────────────────────────────────────────────────

API_ENDPOINTS = [
    ("GET /health",                    "GET",  "/health",                  True),
    ("GET /projects",                  "GET",  "/projects",                False),
    ("GET /marketplace/listings",      "GET",  "/marketplace/listings",    False),
    ("GET /audit/credits/:id/events",  "GET",  "/audit/credits/bench-probe-batch/events", False),
    ("POST /marketplace/purchase",     "POST", "/marketplace/purchase",    False),
]


def run_api_benchmarks(api_url: str, raw_url: str, samples: int, warmup: int, timeout: float) -> dict[str, dict]:
    results: dict[str, dict] = {}
    for label, method, path, use_raw in API_ENDPOINTS:
        base = raw_url.rstrip("/") if use_raw else api_url.rstrip("/")
        url = base + path
        print(f"  API {method} {label} ({samples} samples) ...")
        durations = _measure_http(method, url, samples, warmup, timeout)
        r = _summarize(durations, label)
        r["endpoint"] = label
        results[label] = r
        if r.get("p95_ms") is not None:
            print(f"       p50={r['p50_ms']}ms  p95={r['p95_ms']}ms  p99={r['p99_ms']}ms")
        else:
            print(f"       ERROR: {r.get('error')}")
    return results


# ── 3. DB benchmarks ───────────────────────────────────────────────────────────

DB_QUERIES = [
    ("projects_list_query",
     'SELECT id, "projectId", name, methodology, status FROM "CarbonProject" ORDER BY "createdAt" DESC LIMIT 20'),
    ("marketplace_listings_query",
     'SELECT id, "listingId", price, "amountAvailable" FROM "MarketListing" WHERE status = \'Active\' ORDER BY "createdAt" DESC LIMIT 20'),
    ("audit_events_query",
     'SELECT id, "eventType", "batchId", "createdAt" FROM "CreditEvent" ORDER BY "createdAt" DESC LIMIT 50'),
    ("retirement_lookup_query",
     'SELECT id, "retirementId", amount, "retiredAt" FROM "Retirement" ORDER BY "retiredAt" DESC LIMIT 20'),
]

PROXY_PATHS = {
    "projects_list_query": "/projects",
    "marketplace_listings_query": "/marketplace/listings",
    "audit_events_query": "/audit/credits/bench-probe/events",
    "retirement_lookup_query": "/projects",
}


def run_db_benchmarks_direct(database_url: str, samples: int, warmup: int) -> dict[str, dict]:
    try:
        import psycopg2  # type: ignore
    except ImportError:
        print("  psycopg2 not available — falling back to proxy mode", file=sys.stderr)
        return {}

    results: dict[str, dict] = {}
    try:
        conn = psycopg2.connect(database_url)
        conn.set_session(readonly=True, autocommit=True)
        cur = conn.cursor()
    except Exception as exc:
        print(f"  DB connection failed: {exc} — falling back to proxy", file=sys.stderr)
        return {}

    for key, sql in DB_QUERIES:
        print(f"  DB: {key} ...")
        explain_sql = f"EXPLAIN (ANALYZE, FORMAT JSON) {sql}"
        durations: list[float] = []
        for i in range(warmup + samples):
            t0 = time.perf_counter()
            try:
                cur.execute(explain_sql)
                rows = cur.fetchall()
                if rows and rows[0]:
                    plan = rows[0][0]
                    if isinstance(plan, list) and plan:
                        actual_ms = float(plan[0].get("Execution Time", 0.0))
                        if i >= warmup:
                            durations.append(actual_ms)
                        continue
            except Exception as exc:
                print(f"    query error: {exc}", file=sys.stderr)
            if i >= warmup:
                durations.append((time.perf_counter() - t0) * 1000.0)

        r = _summarize(durations, key)
        r["query"] = key
        r["measurement"] = "db_explain_analyze"
        results[key] = r
        if r.get("p95_ms") is not None:
            print(f"       p50={r['p50_ms']}ms  p95={r['p95_ms']}ms  p99={r['p99_ms']}ms")
        else:
            print(f"       ERROR: {r.get('error')}")

    cur.close()
    conn.close()
    return results


def run_db_benchmarks_proxy(api_url: str, samples: int, warmup: int, timeout: float) -> dict[str, dict]:
    results: dict[str, dict] = {}
    for key, path in PROXY_PATHS.items():
        url = api_url.rstrip("/") + path
        print(f"  DB proxy: {key} via {path} ...")
        durations = _measure_http("GET", url, samples, warmup, timeout)
        r = _summarize(durations, key)
        r["query"] = key
        r["measurement"] = "api_proxy"
        results[key] = r
        if r.get("p95_ms") is not None:
            print(f"       p50={r['p50_ms']}ms  p95={r['p95_ms']}ms  p99={r['p99_ms']}ms  (proxy)")
        else:
            print(f"       ERROR: {r.get('error')}")
    return results


# ── Regression comparison ──────────────────────────────────────────────────────

def compare_dimension(
    section_name: str,
    baseline_section: dict,
    current_section: dict,
    gate_metric: str,
    id_field: str,
) -> tuple[list[str], bool]:
    rows: list[str] = []
    any_regression = False

    for name in sorted(current_section):
        cur = current_section[name]
        base = baseline_section.get(name)
        cur_val = cur.get(gate_metric)

        if cur_val is None:
            rows.append(f"| `{name}` | — | ⚠️ error | ⚠️ skipped (error in current run) |")
            continue

        if base is None:
            rows.append(f"| `{name}` | (new) | {cur_val:.1f} | 🆕 new benchmark |")
            continue

        base_val = base.get(gate_metric)
        if base_val is None or base_val == 0:
            rows.append(f"| `{name}` | — | {cur_val:.1f} | ⚠️ baseline value missing |")
            continue

        pct = (cur_val - base_val) / base_val * 100.0
        is_regression = pct > REGRESSION_THRESHOLD_PCT
        any_regression = any_regression or is_regression

        icon = "🔴 REGRESSION" if is_regression else "✅"
        sign = f"+{pct:.1f}%" if pct >= 0 else f"{pct:.1f}%"
        rows.append(f"| `{name}` | {base_val:.1f} | {cur_val:.1f} | {sign} | {icon} |")

    # Report items in baseline but missing from current
    for name in sorted(set(baseline_section) - set(current_section)):
        rows.append(f"| `{name}` | — | (missing) | — | ⚠️ not measured this run |")

    return rows, any_regression


def build_report(baseline: dict, current: dict) -> tuple[str, bool]:
    now = current.get("generated_at", datetime.now(timezone.utc).isoformat())
    sha = os.environ.get("GITHUB_SHA", "")[:12]
    ref = os.environ.get("GITHUB_REF_NAME", "")

    lines = [
        "## Performance Regression Report",
        "",
        f"> **Run:** {now}  |  **Commit:** `{sha}`  |  **Branch:** {ref}",
        f"> **Threshold:** >{REGRESSION_THRESHOLD_PCT:.0f}% regression = FAIL",
        "",
    ]

    any_regression = False

    # ── 1. Contract
    base_contract = baseline.get("contract", {})
    cur_contract = current.get("contract", {})
    lines += [
        "### 1. Contract Benchmarks (cpu_instructions)",
        "",
        "| Function | Baseline (cpu_insns) | Current (cpu_insns) | Change | Status |",
        "|---|---|---|---|---|",
    ]
    contract_rows, contract_regressed = compare_dimension(
        "contract", base_contract, cur_contract, "cpu_instructions", "function"
    )
    lines += contract_rows or ["| (no data) | — | — | — | ⚠️ |"]
    any_regression = any_regression or contract_regressed

    # ── 2. API
    base_api = baseline.get("api", {})
    cur_api = current.get("api", {})
    lines += [
        "",
        f"### 2. API Response Times (p95_ms — gate metric)",
        "",
        f"| Endpoint | Baseline p95 (ms) | Current p95 (ms) | Change | Status |",
        "|---|---|---|---|---|",
    ]
    api_rows, api_regressed = compare_dimension(
        "api", base_api, cur_api, API_GATE_METRIC, "endpoint"
    )
    lines += api_rows or ["| (no data) | — | — | — | ⚠️ |"]
    any_regression = any_regression or api_regressed

    # ── 3. DB
    base_db = baseline.get("db", {})
    cur_db = current.get("db", {})
    lines += [
        "",
        f"### 3. DB Query Times (p95_ms — gate metric)",
        "",
        f"| Query | Baseline p95 (ms) | Current p95 (ms) | Change | Status |",
        "|---|---|---|---|---|",
    ]
    db_rows, db_regressed = compare_dimension(
        "db", base_db, cur_db, DB_GATE_METRIC, "query"
    )
    lines += db_rows or ["| (no data) | — | — | — | ⚠️ |"]
    any_regression = any_regression or db_regressed

    # ── Summary
    status_icon = "🔴 FAILED" if any_regression else "✅ PASSED"
    lines += [
        "",
        "---",
        f"### Result: {status_icon}",
        "",
    ]
    if any_regression:
        lines.append(
            f"> One or more metrics regressed by more than {REGRESSION_THRESHOLD_PCT:.0f}%. "
            "See rows marked 🔴 above."
        )
    else:
        lines.append("> All metrics within the 10% regression threshold.")
    lines.append("")

    return "\n".join(lines), any_regression


# ── History CSV ────────────────────────────────────────────────────────────────

def append_history(current: dict) -> None:
    """Append summary rows to history.csv for trend tracking."""
    sha = os.environ.get("GITHUB_SHA", "")[:12]
    ref = os.environ.get("GITHUB_REF_NAME", "")
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    note = f"sha:{sha} branch:{ref}".strip()

    rows: list[list[str]] = []

    # Contract rows
    for name, data in current.get("contract", {}).items():
        rows.append([
            date, name,
            str(data.get("cpu_instructions", "")),
            str(data.get("mem_bytes", "")),
            str(data.get("reads", "")),
            str(data.get("writes", "")),
            f"contract {note}",
        ])

    # API rows (record p95 in cpu_instructions column for unified schema)
    for name, data in current.get("api", {}).items():
        p95 = data.get("p95_ms", "")
        rows.append([
            date, name,
            str(p95),  # p95_ms in cpu_instructions column
            str(data.get("p50_ms", "")),  # p50_ms in mem_bytes column
            str(data.get("p99_ms", "")),  # p99_ms in reads column
            "",
            f"api_p95_ms {note}",
        ])

    # DB rows
    for name, data in current.get("db", {}).items():
        p95 = data.get("p95_ms", "")
        rows.append([
            date, name,
            str(p95),
            str(data.get("p50_ms", "")),
            str(data.get("p99_ms", "")),
            "",
            f"db_p95_ms {note}",
        ])

    if not rows:
        return

    write_header = not HISTORY_PATH.exists() or HISTORY_PATH.stat().st_size == 0
    with open(HISTORY_PATH, "a", newline="") as f:
        writer = csv.writer(f)
        if write_header:
            writer.writerow(["date", "function", "cpu_instructions", "mem_bytes", "reads", "writes", "note"])
        writer.writerows(rows)

    print(f"Appended {len(rows)} rows to {HISTORY_PATH.relative_to(REPO_ROOT)}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(description="Unified performance regression tracker")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--run", action="store_true", help="Run all benchmarks from scratch")
    mode.add_argument("--compare-only", action="store_true", help="Compare existing current.json to baseline (no new measurements)")
    mode.add_argument("--contract-log", type=Path, help="Use pre-captured cargo test log for contract benchmarks; still runs API/DB live")
    parser.add_argument("--skip-contract", action="store_true", help="Skip Soroban contract benchmarks (no Rust needed)")
    parser.add_argument("--skip-api", action="store_true", help="Skip API benchmarks")
    parser.add_argument("--skip-db", action="store_true", help="Skip DB benchmarks")
    args = parser.parse_args()

    api_url = os.environ.get("PERF_API_URL", "http://localhost:3001/api/v1")
    raw_url = os.environ.get("PERF_API_RAW_URL", "http://localhost:3001")
    database_url: Optional[str] = os.environ.get("DATABASE_URL")
    samples = int(os.environ.get("BENCH_SAMPLES", "50"))
    warmup = int(os.environ.get("BENCH_WARMUP", "5"))
    timeout = float(os.environ.get("BENCH_TIMEOUT", "10"))

    # ── Compare-only mode ─────────────────────────────────────────────────────
    if args.compare_only:
        current = load_json(CURRENT_PATH)
        if not current:
            print(f"ERROR: {CURRENT_PATH} not found or empty. Run with --run first.", file=sys.stderr)
            return 1
        baseline = load_json(BASELINE_PATH)
        if not baseline:
            print("No baseline found — nothing to compare.")
            return 0
        report, has_regression = build_report(baseline, current)
        print(report)
        REPORT_PATH.write_text(report)
        return 1 if has_regression else 0

    # ── Live measurement modes ────────────────────────────────────────────────
    print("=" * 60)
    print("CarbonLedger Performance Benchmark")
    print("=" * 60)

    current: dict = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "schema_version": "2",
        "contract": {},
        "api": {},
        "db": {},
    }

    # 1. Contract
    if not args.skip_contract:
        print("\n[1/3] Contract benchmarks ...")
        if args.contract_log:
            log_text = args.contract_log.read_text()
        elif args.run:
            log_text = run_contract_benchmarks()
        else:
            log_text = ""

        if log_text:
            current["contract"] = parse_contract_results(log_text)
            if not current["contract"]:
                print("  WARNING: no BENCH_RESULT lines found in contract log", file=sys.stderr)
        else:
            print("  Skipped (no contract log source)")
    else:
        print("\n[1/3] Contract benchmarks — skipped (--skip-contract)")

    # 2. API
    if not args.skip_api:
        print("\n[2/3] API benchmarks ...")
        current["api"] = run_api_benchmarks(api_url, raw_url, samples, warmup, timeout)
    else:
        print("\n[2/3] API benchmarks — skipped (--skip-api)")

    # 3. DB
    if not args.skip_db:
        print("\n[3/3] DB benchmarks ...")
        if database_url:
            db_results = run_db_benchmarks_direct(database_url, samples, warmup)
            if not db_results:
                print("  Falling back to proxy mode ...")
                db_results = run_db_benchmarks_proxy(api_url, samples, warmup, timeout)
        else:
            print("  DATABASE_URL not set — using API proxy mode")
            db_results = run_db_benchmarks_proxy(api_url, samples, warmup, timeout)
        current["db"] = db_results
    else:
        print("\n[3/3] DB benchmarks — skipped (--skip-db)")

    # Write current.json
    BENCHMARKS_DIR.mkdir(exist_ok=True)
    CURRENT_PATH.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
    print(f"\nWrote {CURRENT_PATH.relative_to(REPO_ROOT)}")

    # Load baseline and compare
    baseline = load_json(BASELINE_PATH)
    if not baseline:
        print("\nNo baseline found — treating this as the first run (nothing to compare).")
        print("To create the baseline, copy benchmarks/current.json to benchmarks/baseline.json.")
        append_history(current)
        return 0

    print("\n" + "=" * 60)
    print("Regression Analysis")
    print("=" * 60)

    report, has_regression = build_report(baseline, current)
    print(report)

    REPORT_PATH.write_text(report)
    print(f"Wrote {REPORT_PATH.relative_to(REPO_ROOT)}")

    # Append to history
    append_history(current)

    if has_regression:
        print(
            f"\nFAILED: one or more metrics exceeded the {REGRESSION_THRESHOLD_PCT:.0f}% regression threshold.",
            file=sys.stderr,
        )
        return 1

    print(f"\nOK: all metrics within the {REGRESSION_THRESHOLD_PCT:.0f}% regression threshold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
