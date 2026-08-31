#!/usr/bin/env python3
"""Verify docs/contract-events.md stays in sync with contract event code.

Fails (non-zero exit) if:
  * an event topic published in a contract's `src/lib.rs` is not documented
    in `docs/contract-events.md`
  * a documented event topic no longer exists in the corresponding
    contract's `src/lib.rs`
  * a published event topic (other than the `upgraded` topic, which is
    intentionally excluded — see docs/contract-events.md) has no matching
    assertion in that contract's `tests/events.rs`

Run: python3 scripts/check_event_docs_sync.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTRACTS_DIR = REPO_ROOT / "contracts"
DOCS_PATH = REPO_ROOT / "docs" / "contract-events.md"

# Topics that are documented and published but deliberately not covered by
# an automated event test (see docs/contract-events.md "Testing conventions").
TEST_EXEMPT_TOPICS = {"upgraded"}

CONTRACT_NAMES = [
    "carbon_credit",
    "carbon_marketplace",
    "carbon_registry",
    "carbon_oracle",
]

TOPIC_PAIR_RE = re.compile(
    r'symbol_short!\("c_ledger"\)\s*,\s*symbol_short!\("([a-zA-Z0-9_]+)"\)'
)

# Matches "## `contract_name`" section headers in the docs table.
SECTION_RE = re.compile(r"^## `([a-zA-Z0-9_]+)`\s*$", re.MULTILINE)

# Matches a markdown table cell like `(c_ledger, minted)` within a row.
DOC_TOPIC_RE = re.compile(r"`\(c_ledger,\s*([a-zA-Z0-9_]+)\)`")


def find_topics(path: Path) -> set[str]:
    if not path.exists():
        return set()
    text = path.read_text()
    return set(TOPIC_PAIR_RE.findall(text))


def parse_documented_topics() -> dict[str, set[str]]:
    text = DOCS_PATH.read_text()
    sections = list(SECTION_RE.finditer(text))
    result: dict[str, set[str]] = {}
    for i, m in enumerate(sections):
        name = m.group(1)
        if name not in CONTRACT_NAMES:
            continue
        start = m.end()
        end = sections[i + 1].start() if i + 1 < len(sections) else len(text)
        body = text[start:end]
        result[name] = set(DOC_TOPIC_RE.findall(body))
    return result


def main() -> int:
    if not DOCS_PATH.exists():
        print(f"ERROR: {DOCS_PATH} not found", file=sys.stderr)
        return 1

    documented = parse_documented_topics()
    errors: list[str] = []

    for contract in CONTRACT_NAMES:
        src_path = CONTRACTS_DIR / contract / "src" / "lib.rs"
        tests_path = CONTRACTS_DIR / contract / "tests" / "events.rs"

        published = find_topics(src_path)
        tested = find_topics(tests_path)
        docs = documented.get(contract, set())

        if not published:
            errors.append(f"[{contract}] no events found in {src_path} — is the path right?")
            continue
        if not docs:
            errors.append(f"[{contract}] no '## `{contract}`' section found in {DOCS_PATH}")
            continue

        undocumented = published - docs
        for topic in sorted(undocumented):
            errors.append(
                f"[{contract}] event topic '{topic}' is published in src/lib.rs "
                f"but not documented in docs/contract-events.md"
            )

        stale_docs = docs - published
        for topic in sorted(stale_docs):
            errors.append(
                f"[{contract}] event topic '{topic}' is documented in "
                f"docs/contract-events.md but not published anywhere in src/lib.rs"
            )

        untested = published - tested - TEST_EXEMPT_TOPICS
        for topic in sorted(untested):
            errors.append(
                f"[{contract}] event topic '{topic}' is published but has no "
                f"assertion in {tests_path}"
            )

    if errors:
        print("Event documentation/test sync check FAILED:\n", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        print(
            f"\nUpdate {DOCS_PATH.relative_to(REPO_ROOT)} and/or the relevant "
            "tests/events.rs file to resolve.",
            file=sys.stderr,
        )
        return 1

    print("Event documentation is in sync with contract code and tests.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
