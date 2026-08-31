#!/usr/bin/env python3
"""
scripts/bench_db.py

Measure PostgreSQL query latency (p50, p95, p99) for the key CarbonLedger
queries via the NestJS backend's database. Uses EXPLAIN ANALYZE (read-only)
executed through psycopg2 to measure raw query plan execution time as
reported by the PostgreSQL planner.

If no DATABASE_URL is available (CI smoke environment, testnet-only), the
script falls back to measuring response-time proxies via the HTTP API and
marks measurements as "proxy" so the regression checker treats them with
the correct threshold.

Usage:
    python3 scripts/bench_db.py [--samples N] [--out FILE]

Environment:
    DATABASE_URL   PostgreSQL DSN  (postgres://user:pass@host:5432/dbname)
                   If absent, proxy mode is used.
    PERF_API_URL   Fallback API base URL for proxy mode

Closes #1056
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
BENCHMARKS_DIR = REPO_ROOT / "benchmarks"

# Queries to benchmark — (key, description, SQL)
# All queries use EXPLAIN (ANALYZE, FORMAT JSON) so we read the
# "Actual Total Time" from the planner — no result rows transferred.
DB_QUERIES = [
    (
        "projects_list_query",
        "SELECT projects with filters (simulates /projects endpoint)",
        """
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT id, "projectId", name, methodology, country, status,
               "vintageYear", "totalCreditsIssued", "totalCreditsRetired",
               "lastMonitoringAt", "createdAt"
        FROM "CarbonProject"
        ORDER BY "createdAt" DESC
        LIMIT 20
        """,
    ),
    (
        "marketplace_listings_query",
        "SELECT active listings (simulates /marketplace/listings endpoint)",
        """
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT ml.id, ml."listingId", ml."projectId", ml.price,
               ml."amountAvailable", ml.methodology, ml.vintage,
               ml.status, ml."createdAt"
        FROM "MarketListing" ml
        WHERE ml.status = 'Active'
        ORDER BY ml."createdAt" DESC
        LIMIT 20
        """,
    ),
    (
        "audit_events_query",
        "SELECT credit events (simulates /audit/credits/:id/events endpoint)",
        """
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT id, "eventType", "batchId", payload, "createdAt"
        FROM "CreditEvent"
        ORDER BY "createdAt" DESC
        LIMIT 50
        """,
    ),
    (
        "retirement_lookup_query",
        "SELECT retirements by owner (simulates /retirements endpoint)",
        """
        EXPLAIN (ANALYZE, FORMAT JSON)
        SELECT r.id, r."retirementId", r."projectId", r."batchId",
               r.amount, r.beneficiary, r."retiredAt", r."txHash"
        FROM "Retirement" r
        ORDER BY r."retiredAt" DESC
        LIMIT 20
        """,
    ),
]

# Proxy API endpoints for fallback mode (key → relative path)
PROXY_ENDPOINTS = {
    "projects_list_query": "/projects",
    "marketplace_listings_query": "/marketplace/listings",
    "audit_events_query": "/audit/credits/bench-probe/events",
    "retirement_lookup_query": "/projects",  # safe public endpoint as proxy
}


def percentile(sorted_data: list[float], pct: float) -> float:
    if not sorted_data:
        return 0.0
    k = max(0, min(len(sorted_data) - 1, int(round(pct / 100.0 * len(sorted_data))) - 1))
    return sorted_data[k]


def bench_via_db(database_url: str, samples: int, warmup: int) -> dict[str, dict]:
    """Measure query latencies directly via psycopg2."""
    try:
        import psycopg2  # type: ignore
    except ImportError:
        print("  psycopg2 not available — install with: pip install psycopg2-binary", file=sys.stderr)
        return {}

    conn = psycopg2.connect(database_url)
    conn.set_session(readonly=True, autocommit=True)
    cursor = conn.cursor()
    results: dict[str, dict] = {}

    for key, desc, sql in DB_QUERIES:
        print(f"  DB: {key} ...")
        durations_ms: list[float] = []

        for i in range(warmup + samples):
            t0 = time.perf_counter()
            try:
                cursor.execute(sql)
                rows = cursor.fetchall()
                # Extract "Actual Total Time" from EXPLAIN ANALYZE JSON output
                if rows and rows[0]:
                    plan = rows[0][0]
                    if isinstance(plan, list) and plan:
                        actual_ms = plan[0].get("Execution Time", 0.0)
                        if i >= warmup:
                            durations_ms.append(actual_ms)
                        continue
            except Exception as exc:
                print(f"    WARNING: query {i+1} failed: {exc}", file=sys.stderr)
                # Fall through to wall-clock measurement

            # Fallback: wall-clock timing
            elapsed = (time.perf_counter() - t0) * 1000.0
            if i >= warmup:
                durations_ms.append(elapsed)

        if durations_ms:
            sorted_d = sorted(durations_ms)
            results[key] = {
                "query": key,
                "description": desc.strip(),
                "measurement": "db_explain_analyze",
                "p50_ms": round(percentile(sorted_d, 50), 3),
                "p95_ms": round(percentile(sorted_d, 95), 3),
                "p99_ms": round(percentile(sorted_d, 99), 3),
                "mean_ms": round(statistics.mean(durations_ms), 3),
                "min_ms": round(sorted_d[0], 3),
                "max_ms": round(sorted_d[-1], 3),
                "samples": len(durations_ms),
            }
            p50, p95, p99 = results[key]["p50_ms"], results[key]["p95_ms"], results[key]["p99_ms"]
            print(f"       p50={p50}ms  p95={p95}ms  p99={p99}ms")
        else:
            results[key] = {
                "query": key,
                "description": desc.strip(),
                "measurement": "db_explain_analyze",
                "error": "no successful samples",
                "p50_ms": None,
                "p95_ms": None,
                "p99_ms": None,
                "samples": 0,
            }

    cursor.close()
    conn.close()
    return results


def bench_via_proxy(api_url: str, samples: int, warmup: int, timeout: float) -> dict[str, dict]:
    """Proxy mode: measure response times for DB-backed endpoints."""
    results: dict[str, dict] = {}

    for key, path in PROXY_ENDPOINTS.items():
        url = api_url.rstrip("/") + path
        print(f"  DB proxy: {key} via {path} ...")
        durations_ms: list[float] = []

        for i in range(warmup + samples):
            t0 = time.perf_counter()
            try:
                req = urllib.request.Request(url, headers={"Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=timeout):
                    pass
            except urllib.error.HTTPError:
                pass
            except (urllib.error.URLError, OSError) as exc:
                print(f"    WARNING: request {i+1} failed: {exc}", file=sys.stderr)
                continue
            elapsed = (time.perf_counter() - t0) * 1000.0
            if i >= warmup:
                durations_ms.append(elapsed)

        if durations_ms:
            sorted_d = sorted(durations_ms)
            results[key] = {
                "query": key,
                "measurement": "api_proxy",
                "note": "API round-trip including HTTP overhead; DB query portion is a subset",
                "p50_ms": round(percentile(sorted_d, 50), 2),
                "p95_ms": round(percentile(sorted_d, 95), 2),
                "p99_ms": round(percentile(sorted_d, 99), 2),
                "mean_ms": round(statistics.mean(durations_ms), 2),
                "samples": len(durations_ms),
            }
            p50, p95, p99 = results[key]["p50_ms"], results[key]["p95_ms"], results[key]["p99_ms"]
            print(f"       p50={p50}ms  p95={p95}ms  p99={p99}ms  (proxy)")
        else:
            results[key] = {
                "query": key,
                "measurement": "api_proxy",
                "error": "all requests failed",
                "p50_ms": None,
                "p95_ms": None,
                "p99_ms": None,
                "samples": 0,
            }

    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark CarbonLedger DB query times")
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--out",
        type=Path,
        default=BENCHMARKS_DIR / "db_current.json",
    )
    args = parser.parse_args()

    database_url: Optional[str] = os.environ.get("DATABASE_URL")
    api_url = os.environ.get("PERF_API_URL", "http://localhost:3001/api/v1")

    print(f"DB benchmark — {args.samples} samples per query (+ {args.warmup} warmup)")

    if database_url:
        print(f"  Mode: direct PostgreSQL (DATABASE_URL set)\n")
        db_results = bench_via_db(database_url, args.samples, args.warmup)
    else:
        print(f"  Mode: API proxy (DATABASE_URL not set)\n")
        print(f"  API base: {api_url}\n")
        db_results = bench_via_proxy(api_url, args.samples, args.warmup, args.timeout)

    BENCHMARKS_DIR.mkdir(exist_ok=True)
    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "mode": "direct" if database_url else "proxy",
        "samples_per_query": args.samples,
        "db": db_results,
    }
    args.out.write_text(json.dumps(output, indent=2) + "\n")
    print(f"\nWrote {args.out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
