#!/usr/bin/env python3
"""
Atheris (libFuzzer) harness for verification_listener.validate_methodology_report.

Feeds raw bytes as JSON text into the untrusted-input entry point of
verification_listener.py. Any uncaught exception is a crash.

Usage (requires the `atheris` package — Linux/macOS + clang only):
    pip install atheris
    python tests/fuzz/oracle/verification_listener/fuzz_validate_methodology_report.py \\
        tests/fuzz/oracle/verification_listener/corpus/ -max_total_time=60

Run without arguments to just replay the committed corpus once (no atheris
required) — see `_replay_corpus()` below, used by the PR-blocking CI check
that doesn't have the clang toolchain available.
"""

import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
import _env  # noqa: E402,F401 — sets up sys.path + required env vars

from verification_listener import validate_methodology_report  # noqa: E402

_METHODOLOGIES = ["VCS", "Gold Standard", "ACM", "unknown", ""]


def _exercise(raw_text: str) -> None:
    try:
        payload = json.loads(raw_text)
    except (ValueError, RecursionError):
        return
    if not isinstance(payload, dict):
        return
    for methodology in _METHODOLOGIES:
        validate_methodology_report(payload, methodology)


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
