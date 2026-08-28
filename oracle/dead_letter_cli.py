#!/usr/bin/env python
"""
dead_letter_cli.py — operator tooling for the PostgreSQL dead-letter table (#578).

The Redis-backed `dlq_reprocessor.py` still serves the price oracle. This tool
covers the verification listener's durable dead letters, which carry the full
failure history and survive a Redis flush.

    # what is stuck, and why
    python3 oracle/dead_letter_cli.py list

    # current unresolved depth, and alert if it is over threshold
    python3 oracle/dead_letter_cli.py depth --alert

    # mark an entry handled once the underlying cause is fixed
    python3 oracle/dead_letter_cli.py resolve <submission_id> --note "RPC endpoint replaced"

Replaying is deliberately *not* a command here. A dead letter still holds its
allocated nonce, so replay must go back through `IdempotentRetrySubmitter`
inside the listener — reissuing it from a CLI would bypass the idempotency
claim that makes exactly-once work.

Exit codes:
    0  ok (for `depth`: at or below threshold)
    1  depth above threshold
    2  could not run
"""

from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from retry_submitter import DeadLetterStore  # noqa: E402

EXIT_OK = 0
EXIT_OVER_THRESHOLD = 1
EXIT_ERROR = 2


def _format_entries(entries: list[dict]) -> str:
    if not entries:
        return "No unresolved dead letters."

    lines = [f"{len(entries)} unresolved dead letter(s):", ""]
    for entry in entries:
        lines.append(f"  {entry['submission_id'][:16]}…  {entry['function_name']}")
        lines.append(f"      service     : {entry['service']}")
        lines.append(f"      attempts    : {entry['attempts']}")
        lines.append(f"      nonce       : {entry['nonce']}")
        lines.append(f"      first failed: {entry['first_failed_at']}")
        lines.append(f"      last failed : {entry['last_failed_at']}")
        lines.append(f"      last error  : {entry['last_error']}")
        lines.append("")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect the oracle dead-letter table")
    parser.add_argument("--database-url", default=None, help="Override DATABASE_URL")
    parser.add_argument("--json", action="store_true", help="Emit JSON")
    sub = parser.add_subparsers(dest="command", required=True)

    list_cmd = sub.add_parser("list", help="List unresolved dead letters")
    list_cmd.add_argument("--limit", type=int, default=50)
    list_cmd.add_argument("--include-resolved", action="store_true")

    depth_cmd = sub.add_parser("depth", help="Report unresolved depth")
    depth_cmd.add_argument(
        "--alert", action="store_true", help="Dispatch the configured alert if over threshold"
    )
    depth_cmd.add_argument("--threshold", type=int, default=None)

    resolve_cmd = sub.add_parser("resolve", help="Mark an entry handled")
    resolve_cmd.add_argument("submission_id")
    resolve_cmd.add_argument("--note", default=None)

    args = parser.parse_args(argv)

    database_url = args.database_url or os.environ.get("DATABASE_URL", "")
    if not database_url:
        print("error: set DATABASE_URL or pass --database-url", file=sys.stderr)
        return EXIT_ERROR

    store = DeadLetterStore(
        database_url=database_url,
        alert_threshold=getattr(args, "threshold", None),
    )

    try:
        if args.command == "list":
            entries = store.list_entries(
                limit=args.limit, include_resolved=args.include_resolved
            )
            print(
                json.dumps(entries, indent=2, default=str)
                if args.json
                else _format_entries(entries)
            )
            return EXIT_OK

        if args.command == "depth":
            depth = store.depth()
            over = depth > store.alert_threshold
            if args.alert and over:
                store.check_depth_and_alert()
            if args.json:
                print(
                    json.dumps(
                        {
                            "depth": depth,
                            "threshold": store.alert_threshold,
                            "over_threshold": over,
                        }
                    )
                )
            else:
                state = "OVER THRESHOLD" if over else "ok"
                print(f"Dead-letter depth: {depth} (threshold {store.alert_threshold}) — {state}")
            return EXIT_OVER_THRESHOLD if over else EXIT_OK

        store.resolve(args.submission_id, args.note)
        print(f"Resolved {args.submission_id}")
        return EXIT_OK

    except Exception as e:  # noqa: BLE001 — surface any DB problem as EXIT_ERROR
        print(f"error: {e}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
