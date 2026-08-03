#!/usr/bin/env python3
"""Run/parse contract performance benchmarks and gate on regressions.

See docs/benchmarking.md for the full methodology.

Usage:
    # Run cargo test for the benchmarked crates, capture output, compare:
    python3 scripts/compare_benchmarks.py --run

    # Parse a previously captured `cargo test ... -- --nocapture` log:
    python3 scripts/compare_benchmarks.py --log-file /tmp/bench.log

Writes benchmarks/current.json. Exits non-zero (blocking CI/merge) if any
benchmarked function's cpu_instructions increased by more than
REGRESSION_THRESHOLD_PCT relative to benchmarks/baseline.json.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = REPO_ROOT / "contracts"
BENCHMARKS_DIR = REPO_ROOT / "benchmarks"
BASELINE_PATH = BENCHMARKS_DIR / "baseline.json"
CURRENT_PATH = BENCHMARKS_DIR / "current.json"

# Crates that currently have a tests/benchmarks.rs harness (issue #642).
BENCHMARKED_CRATES = ["carbon_credit", "carbon_marketplace"]

REGRESSION_THRESHOLD_PCT = 10.0

BENCH_LINE_RE = re.compile(r"^BENCH_RESULT (\{.*\})\s*$")


def run_cargo_benchmarks() -> str:
    output = []
    for crate in BENCHMARKED_CRATES:
        result = subprocess.run(
            ["cargo", "test", "-p", crate, "--test", "benchmarks", "--", "--nocapture"],
            cwd=CONTRACTS_DIR,
            capture_output=True,
            text=True,
        )
        output.append(result.stdout)
        output.append(result.stderr)
        if result.returncode != 0:
            print(f"ERROR: benchmark tests failed for {crate}:", file=sys.stderr)
            print(result.stdout, file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            sys.exit(1)
    return "\n".join(output)


def parse_bench_results(log_text: str) -> dict[str, dict]:
    results: dict[str, dict] = {}
    for line in log_text.splitlines():
        m = BENCH_LINE_RE.match(line.strip())
        if not m:
            continue
        record = json.loads(m.group(1))
        results[record["function"]] = record
    return results


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text())


def compare(baseline: dict, current: dict) -> tuple[list[str], bool]:
    lines = [
        "| Function | Baseline (cpu_insns) | Current (cpu_insns) | Change | Status |",
        "|---|---|---|---|---|",
    ]
    any_regression = False

    for name in sorted(current):
        cur = current[name]
        base = baseline.get(name)
        if base is None:
            lines.append(f"| `{name}` | (new) | {cur['cpu_instructions']:,} | — | 🆕 new benchmark |")
            continue

        base_cpu = base["cpu_instructions"]
        cur_cpu = cur["cpu_instructions"]
        if base_cpu == 0:
            pct = 0.0 if cur_cpu == 0 else float("inf")
        else:
            pct = (cur_cpu - base_cpu) / base_cpu * 100

        is_regression = pct > REGRESSION_THRESHOLD_PCT
        any_regression = any_regression or is_regression
        status = f"🔴 REGRESSION (+{pct:.1f}%)" if is_regression else f"✅ ({pct:+.1f}%)"
        lines.append(
            f"| `{name}` | {base_cpu:,} | {cur_cpu:,} | {pct:+.1f}% | {status} |"
        )

    missing = sorted(set(baseline) - set(current))
    for name in missing:
        lines.append(f"| `{name}` | {baseline[name]['cpu_instructions']:,} | (missing) | — | ⚠️ not run this build |")

    return lines, any_regression


def main() -> int:
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--run", action="store_true", help="run cargo test benchmarks now")
    group.add_argument("--log-file", type=Path, help="parse an existing captured test log")
    args = parser.parse_args()

    log_text = run_cargo_benchmarks() if args.run else args.log_file.read_text()

    current = parse_bench_results(log_text)
    if not current:
        print("ERROR: no BENCH_RESULT lines found in benchmark output", file=sys.stderr)
        return 1

    BENCHMARKS_DIR.mkdir(exist_ok=True)
    CURRENT_PATH.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n")
    print(f"Wrote {CURRENT_PATH.relative_to(REPO_ROOT)}")

    baseline = load_json(BASELINE_PATH)
    if not baseline:
        print(
            f"No baseline at {BASELINE_PATH.relative_to(REPO_ROOT)} — "
            "treating this run as the baseline (nothing to compare)."
        )
        return 0

    report_lines, has_regression = compare(baseline, current)
    report = "\n".join(report_lines)
    print("\nBenchmark comparison vs. baseline (main):\n")
    print(report)

    summary_path = Path.cwd() / "benchmark-report.md"
    summary_path.write_text(
        "## Contract Performance Benchmark Report\n\n" + report + "\n"
    )
    print(f"\nWrote {summary_path}")

    if has_regression:
        print(
            f"\nFAILED: at least one benchmarked function regressed by more than "
            f"{REGRESSION_THRESHOLD_PCT}% in cpu_instructions.",
            file=sys.stderr,
        )
        return 1

    print("\nOK: no benchmark exceeds the regression threshold.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
