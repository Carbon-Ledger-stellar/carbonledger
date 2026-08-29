#!/usr/bin/env python3
"""
scripts/bench_api.py

Measure API response time percentiles (p50, p95, p99) for key CarbonLedger
endpoints. Writes results to benchmarks/api_current.json in the same schema
as the api section of benchmarks/baseline.json.

Usage:
    python3 scripts/bench_api.py [--api-url URL] [--samples N] [--out FILE]

Options:
    --api-url   Base API URL, e.g. http://localhost:3001/api/v1
                (default: $PERF_API_URL or http://localhost:3001/api/v1)
    --raw-url   Raw server URL for /health
                (default: $PERF_API_RAW_URL or http://localhost:3001)
    --samples   Number of requests per endpoint  (default: 50)
    --warmup    Warmup requests per endpoint before measuring (default: 5)
    --out       Output file path (default: benchmarks/api_current.json)
    --timeout   Per-request timeout in seconds (default: 10)

Exits 0 on success (results written), 1 on fatal error.

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

# Endpoints to benchmark — (label, method, path_suffix, uses_raw_url)
ENDPOINTS = [
    ("GET /health",                    "GET",  "/health",                 True),
    ("GET /projects",                  "GET",  "/projects",               False),
    ("GET /marketplace/listings",      "GET",  "/marketplace/listings",   False),
    ("GET /audit/credits/:id/events",  "GET",  "/audit/credits/bench-probe-batch/events", False),
    # Purchase endpoint: unauthenticated → 401; we still measure *response* time
    ("POST /marketplace/purchase",     "POST", "/marketplace/purchase",   False),
]


def percentile(sorted_data: list[float], pct: float) -> float:
    """Nearest-rank percentile."""
    if not sorted_data:
        return 0.0
    k = max(0, min(len(sorted_data) - 1, int(round(pct / 100.0 * len(sorted_data))) - 1))
    return sorted_data[k]


def measure_endpoint(
    label: str,
    method: str,
    url: str,
    samples: int,
    timeout: float,
    warmup: int,
) -> dict:
    """Fire `warmup + samples` requests; return p50/p95/p99 over the last `samples`."""
    durations_ms: list[float] = []

    # POST body for purchase endpoint (will 401 without JWT — that's fine,
    # we're measuring transport + handler latency, not auth overhead)
    body: Optional[bytes] = None
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if method == "POST":
        body = b'{"listingId":"bench-probe","amount":1,"buyerPublicKey":"bench"}'

    for i in range(warmup + samples):
        t0 = time.perf_counter()
        try:
            req = urllib.request.Request(url, data=body, headers=headers, method=method)
            with urllib.request.urlopen(req, timeout=timeout):
                pass
        except urllib.error.HTTPError:
            pass  # 4xx/5xx: we got a response — latency is still valid
        except (urllib.error.URLError, OSError) as exc:
            print(f"  WARNING: {label} request {i+1} failed: {exc}", file=sys.stderr)
            continue
        elapsed = (time.perf_counter() - t0) * 1000.0  # ms

        if i >= warmup:
            durations_ms.append(elapsed)

    if not durations_ms:
        return {
            "endpoint": label,
            "p50_ms": None,
            "p95_ms": None,
            "p99_ms": None,
            "samples": 0,
            "error": "all requests failed",
        }

    sorted_d = sorted(durations_ms)
    return {
        "endpoint": label,
        "p50_ms": round(percentile(sorted_d, 50), 2),
        "p95_ms": round(percentile(sorted_d, 95), 2),
        "p99_ms": round(percentile(sorted_d, 99), 2),
        "mean_ms": round(statistics.mean(durations_ms), 2),
        "min_ms": round(sorted_d[0], 2),
        "max_ms": round(sorted_d[-1], 2),
        "samples": len(durations_ms),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Benchmark CarbonLedger API response times")
    parser.add_argument(
        "--api-url",
        default=os.environ.get("PERF_API_URL", "http://localhost:3001/api/v1"),
    )
    parser.add_argument(
        "--raw-url",
        default=os.environ.get("PERF_API_RAW_URL", "http://localhost:3001"),
    )
    parser.add_argument("--samples", type=int, default=50)
    parser.add_argument("--warmup", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--out",
        type=Path,
        default=BENCHMARKS_DIR / "api_current.json",
    )
    args = parser.parse_args()

    api_url = args.api_url.rstrip("/")
    raw_url = args.raw_url.rstrip("/")

    print(f"API benchmark — {args.samples} samples per endpoint (+ {args.warmup} warmup)")
    print(f"  API base:  {api_url}")
    print(f"  Raw base:  {raw_url}")
    print()

    results: dict[str, dict] = {}

    for label, method, path, use_raw in ENDPOINTS:
        base = raw_url if use_raw else api_url
        url = base + path
        print(f"  {method:4s} {label} ...")
        result = measure_endpoint(label, method, url, args.samples, args.timeout, args.warmup)
        results[label] = result
        p50 = result.get("p50_ms")
        p95 = result.get("p95_ms")
        p99 = result.get("p99_ms")
        if p50 is not None:
            print(f"       p50={p50}ms  p95={p95}ms  p99={p99}ms  (n={result['samples']})")
        else:
            print(f"       ERROR: {result.get('error')}")

    BENCHMARKS_DIR.mkdir(exist_ok=True)
    output = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "api_url": api_url,
        "samples_per_endpoint": args.samples,
        "api": results,
    }
    args.out.write_text(json.dumps(output, indent=2) + "\n")
    print(f"\nWrote {args.out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
