#!/usr/bin/env python3
"""
Atheris (libFuzzer) harness for satellite_monitor.detect_contradiction /
coordinates_match.

Feeds raw bytes as JSON text — expected shape mirrors the satellite webhook
body, e.g. `{"deforestation_pct": ..., "reported_tonnes_sequestered": ...,
"project_type": ..., "coordinates": {"lat": ..., "lon": ...}}` — into the
untrusted-input entry points of satellite_monitor.py. Any uncaught exception
is a crash.

Usage (requires the `atheris` package — Linux/macOS + clang only):
    pip install atheris
    python tests/fuzz/oracle/satellite_monitor/fuzz_detect_contradiction.py \\
        tests/fuzz/oracle/satellite_monitor/corpus/ -max_total_time=60

Run without arguments to just replay the committed corpus once (no atheris
required) — see `_replay_corpus()` below.
"""

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import _env  # noqa: E402,F401 — sets up sys.path + required env vars

from satellite_monitor import detect_contradiction, coordinates_match  # noqa: E402


def _exercise(raw_text: str) -> None:
    try:
        payload = json.loads(raw_text)
    except (ValueError, RecursionError):
        return
    if not isinstance(payload, dict):
        return
    detect_contradiction(payload)
    coords = payload.get("coordinates")
    if isinstance(coords, dict):
        coordinates_match(coords, coords)
        coordinates_match({"lat": 0, "lon": 0}, coords)


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
