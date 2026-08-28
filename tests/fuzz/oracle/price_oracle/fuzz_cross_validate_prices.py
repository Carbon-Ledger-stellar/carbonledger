#!/usr/bin/env python3
"""
Atheris (libFuzzer) harness for price_oracle.cross_validate_prices /
aggregate_prices.

Feeds raw bytes as JSON text — expected shape is
`{"source_name": [{"methodology": ..., "vintage_year": ..., "price_usd": ...}, ...]}`
— into the untrusted price-feed entry points of price_oracle.py. Any
uncaught exception is a crash.

Usage (requires the `atheris` package — Linux/macOS + clang only):
    pip install atheris
    python tests/fuzz/oracle/price_oracle/fuzz_cross_validate_prices.py \\
        tests/fuzz/oracle/price_oracle/corpus/ -max_total_time=60

Run without arguments to just replay the committed corpus once (no atheris
required) — see `_replay_corpus()` below.
"""

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import _env  # noqa: E402,F401 — sets up sys.path + required env vars

from price_oracle import aggregate_prices, cross_validate_prices  # noqa: E402


def _exercise(raw_text: str) -> None:
    try:
        payload = json.loads(raw_text)
    except (ValueError, RecursionError):
        return
    if isinstance(payload, dict):
        cross_validate_prices({k: v for k, v in payload.items() if isinstance(v, list)})
        lists = [v for v in payload.values() if isinstance(v, list)]
        if len(lists) >= 2:
            aggregate_prices(lists[0], lists[1])
        elif len(lists) == 1:
            aggregate_prices(lists[0], [])


def _replay_corpus() -> None:
    corpus_dir = os.path.join(os.path.dirname(__file__), "corpus")
    for name in sorted(os.listdir(corpus_dir)):
        path = os.path.join(corpus_dir, name)
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            _exercise(f.read())
    print(f"Replayed {len(os.listdir(corpus_dir))} corpus seeds with no crash.")


def TestOneInput(data: bytes) -> None:
    try:
        text = data.decode("utf-8", errors="ignore")
    except Exception:
        return
    _exercise(text)


if __name__ == "__main__":
    try:
        import atheris
    except ImportError:
        print("atheris not installed — replaying corpus only (`pip install atheris` for real fuzzing)")
        _replay_corpus()
    else:
        atheris.Setup(sys.argv, TestOneInput)
        atheris.Fuzz()
