#!/usr/bin/env python
"""
verify_audit_chain.py — independent integrity check of the oracle submission
audit chain (issue #577).

Walks ``oracle_audit_chain`` from genesis to the latest record, recomputing
every hash link, and reports any gap or mismatch.  Intended to be pointed at a
read-only replica so an auditor can verify the log without write access.

    # full chain
    python3 oracle/verify_audit_chain.py

    # resume from a known-good checkpoint (much cheaper on a long chain)
    python3 oracle/verify_audit_chain.py --from-sequence 250000

    # machine-readable, for a scheduled job
    python3 oracle/verify_audit_chain.py --json

Exit codes:
    0  chain intact
    1  chain broken — one or more gaps or hash mismatches (details on stdout)
    2  could not run the check (no DATABASE_URL, connection failure, …)
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from audit_chain import AuditChain, ChainVerification  # noqa: E402

EXIT_OK = 0
EXIT_BROKEN = 1
EXIT_ERROR = 2


def format_report(result: ChainVerification, from_sequence: int) -> str:
    """Human-readable summary of a chain walk."""
    lines: list[str] = []
    scope = "genesis" if from_sequence <= 1 else f"sequence {from_sequence}"
    lines.append(f"Oracle audit chain — verified from {scope} to latest")
    lines.append(f"  records checked : {result.checked}")

    if result.checked:
        lines.append(f"  sequence range  : {result.first_sequence} … {result.last_sequence}")
        lines.append(f"  head hash       : {result.head_hash}")

    if result.valid:
        lines.append("")
        lines.append(
            "  ✅ CHAIN INTACT — every record hashes to its stored digest and "
            "links to its predecessor."
        )
        return "\n".join(lines)

    lines.append(f"  failures        : {len(result.errors)}")
    lines.append("")
    lines.append("  ❌ CHAIN BROKEN")
    for error in result.errors:
        lines.append(f"     - {error}")
    lines.append("")
    lines.append(
        "  A gap means records were deleted; a hash_mismatch means a record was "
        "modified after it was written.  Escalate per docs/runbooks/oracle-failure.md."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Verify the integrity of the oracle submission audit chain"
    )
    parser.add_argument(
        "--from-sequence",
        type=int,
        default=1,
        help="Start the walk at this sequence number (default: 1, i.e. genesis)",
    )
    parser.add_argument("--json", action="store_true", help="Emit the result as JSON")
    parser.add_argument(
        "--database-url",
        default=None,
        help="Override DATABASE_URL (e.g. point at a read-only replica)",
    )
    args = parser.parse_args(argv)

    database_url = args.database_url or os.environ.get("DATABASE_URL", "")
    if not database_url:
        print(
            "error: no database configured — set DATABASE_URL or pass --database-url",
            file=sys.stderr,
        )
        return EXIT_ERROR

    if args.from_sequence < 1:
        print("error: --from-sequence must be >= 1", file=sys.stderr)
        return EXIT_ERROR

    try:
        result = AuditChain(database_url=database_url).verify(from_sequence=args.from_sequence)
    except Exception as e:  # noqa: BLE001 — surface any DB problem as EXIT_ERROR
        print(f"error: chain verification could not run: {e}", file=sys.stderr)
        return EXIT_ERROR

    if args.json:
        print(json.dumps(result.to_dict(), indent=2, default=str))
    else:
        print(format_report(result, args.from_sequence))

    return EXIT_OK if result.valid else EXIT_BROKEN


if __name__ == "__main__":
    raise SystemExit(main())
