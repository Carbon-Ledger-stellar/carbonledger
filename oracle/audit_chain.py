"""
audit_chain.py — tamper-evident audit log for oracle submissions (issue #577).

Every submission the oracle bridge makes to a Soroban contract is appended to
``oracle_audit_chain`` as a hash-linked record:

    entry_hash[n] = SHA256( canonical_fields[n] || entry_hash[n-1] )

An independent auditor can therefore replay the chain from genesis and detect
any retroactive edit:

  * **modified record**  — its own ``entry_hash`` no longer matches its fields
  * **deleted record**   — leaves a hole in the ``sequence`` column, and breaks
                           the ``previous_hash`` link of its successor
  * **inserted record**  — cannot produce a valid link without re-deriving every
                           later ``entry_hash``, which changes the chain head

Sequence numbers are contiguous from 1, so a gap is detectable on its own even
if an attacker recomputes hashes for the records they kept — they would still
have to renumber, which is itself detected as a link break at the seam.

Canonical field order (pipe-joined, matching the backend AuditLog convention in
``backend/src/audit/audit.service.ts``):

    sequence | recorded_at | service | contract_id | function_name
             | payload_hash | tx_hash | status | previous_hash

Scope (per the issue): PostgreSQL only.  The chain head is deliberately *not*
written on chain (too expensive) and the log is not publicly exposed in real
time — auditors run :mod:`verify_audit_chain` against a database replica.
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import psycopg2
import psycopg2.extras
from log import get_logger

log = get_logger("audit_chain")

DATABASE_URL = os.environ.get("DATABASE_URL", "")

#: Advisory-lock key serialising chain appends across processes.  Two writers
#: reading the same head concurrently would fork the chain, so appends take
#: this transaction-scoped lock before reading the tail.
_CHAIN_LOCK_KEY = 5770001

#: Submission outcomes worth recording.  Failures are recorded too: an auditor
#: needs to see attempted submissions, not just the ones that landed.
STATUS_SUBMITTED = "submitted"
STATUS_FAILED = "failed"

# Failure kinds reported by :func:`verify_records`.
GAP = "gap"
HASH_MISMATCH = "hash_mismatch"
BROKEN_LINK = "broken_link"
GENESIS_MISMATCH = "genesis_mismatch"


# ── Hashing (pure — no I/O, directly testable) ────────────────────────────────


def canonical_json(payload: Any) -> str:
    """Deterministic JSON: sorted keys, no insignificant whitespace."""
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)


def compute_payload_hash(payload: Any) -> str:
    """SHA-256 over the canonical JSON form of a submission payload."""
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


def _isoformat(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(UTC).isoformat()
    return str(value)


def compute_entry_hash(
    sequence: int,
    recorded_at: Any,
    service: str,
    contract_id: str | None,
    function_name: str,
    payload_hash: str,
    tx_hash: str | None,
    status: str,
    previous_hash: str | None,
) -> str:
    """
    SHA-256 over the canonical field ordering plus the previous entry's hash.

    Every immutable field participates, so editing any of them — including the
    recorded timestamp — invalidates the digest.
    """
    canonical = "|".join(
        [
            str(sequence),
            _isoformat(recorded_at),
            service,
            contract_id or "",
            function_name,
            payload_hash,
            tx_hash or "",
            status,
            previous_hash or "",
        ]
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def entry_hash_for_record(record: dict) -> str:
    """Recompute the ``entry_hash`` a stored record *should* have."""
    return compute_entry_hash(
        sequence=int(record["sequence"]),
        recorded_at=record["recorded_at"],
        service=record["service"],
        contract_id=record.get("contract_id"),
        function_name=record["function_name"],
        payload_hash=record["payload_hash"],
        tx_hash=record.get("tx_hash"),
        status=record["status"],
        previous_hash=record.get("previous_hash"),
    )


# ── Verification ──────────────────────────────────────────────────────────────


@dataclass
class ChainError:
    """A single integrity failure found while walking the chain."""

    kind: str
    sequence: int | None
    detail: str

    def to_dict(self) -> dict:
        return {"kind": self.kind, "sequence": self.sequence, "detail": self.detail}

    def __str__(self) -> str:
        where = f"sequence {self.sequence}" if self.sequence is not None else "chain"
        return f"[{self.kind}] {where}: {self.detail}"


@dataclass
class ChainVerification:
    """Result of a full or partial chain walk."""

    checked: int = 0
    errors: list[ChainError] = field(default_factory=list)
    first_sequence: int | None = None
    last_sequence: int | None = None
    head_hash: str | None = None

    @property
    def valid(self) -> bool:
        return not self.errors

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "checked": self.checked,
            "first_sequence": self.first_sequence,
            "last_sequence": self.last_sequence,
            "head_hash": self.head_hash,
            "errors": [e.to_dict() for e in self.errors],
        }


def verify_records(
    records: Sequence[dict],
    expect_genesis: bool = True,
    expected_previous_hash: str | None = None,
) -> ChainVerification:
    """
    Walk ``records`` (ordered by ascending sequence) and verify every link.

    Pure function — the CLI, the unit tests and any auditor tooling all share
    this one implementation.

    ``expect_genesis`` is False when verifying a slice starting mid-chain; in
    that case ``expected_previous_hash`` supplies the link into the slice.
    """
    result = ChainVerification(checked=len(records))
    if not records:
        return result

    result.first_sequence = int(records[0]["sequence"])
    result.last_sequence = int(records[-1]["sequence"])

    expect_prev = expected_previous_hash
    expect_seq: int | None = None

    for record in records:
        sequence = int(record["sequence"])

        # ── Gap detection ────────────────────────────────────────────────────
        if expect_seq is None:
            if expect_genesis and sequence != 1:
                result.errors.append(
                    ChainError(
                        GAP,
                        sequence,
                        f"chain starts at sequence {sequence}, expected 1 "
                        f"({sequence - 1} record(s) missing from the head)",
                    )
                )
        elif sequence != expect_seq:
            missing = sequence - expect_seq
            result.errors.append(
                ChainError(
                    GAP,
                    sequence,
                    f"expected sequence {expect_seq}, found {sequence} "
                    f"({missing} record(s) missing)",
                )
            )
        expect_seq = sequence + 1

        # ── Link check ───────────────────────────────────────────────────────
        stored_prev = record.get("previous_hash")
        if expect_prev is None and stored_prev is None:
            pass  # genesis record: no predecessor
        elif stored_prev != expect_prev:
            kind = GENESIS_MISMATCH if expect_prev is None else BROKEN_LINK
            result.errors.append(
                ChainError(
                    kind,
                    sequence,
                    f"previous_hash is {stored_prev or 'NULL'}, "
                    f"expected {expect_prev or 'NULL'}",
                )
            )

        # ── Content check ────────────────────────────────────────────────────
        expected_hash = entry_hash_for_record(record)
        stored_hash = record.get("entry_hash")
        if expected_hash != stored_hash:
            result.errors.append(
                ChainError(
                    HASH_MISMATCH,
                    sequence,
                    f"entry_hash is {stored_hash}, recomputes to {expected_hash} "
                    "— this record was modified after it was written",
                )
            )

        # Continue from what is actually stored, so one bad record produces one
        # mismatch rather than cascading a link error into every successor.
        expect_prev = stored_hash

    result.head_hash = records[-1].get("entry_hash")
    return result


# ── Append / read ─────────────────────────────────────────────────────────────


_INSERT_SQL = """
INSERT INTO oracle_audit_chain
    (sequence, recorded_at, service, contract_id, function_name,
     payload, payload_hash, tx_hash, status, previous_hash, entry_hash)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
RETURNING id;
"""

_SELECT_TAIL_SQL = """
SELECT sequence, entry_hash
  FROM oracle_audit_chain
 ORDER BY sequence DESC
 LIMIT 1;
"""


class AuditChain:
    """Append-only hash chain of oracle submissions, stored in PostgreSQL."""

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url if database_url is not None else DATABASE_URL

    # ── writing ──────────────────────────────────────────────────────────────

    def record(
        self,
        service: str,
        function_name: str,
        payload: Any,
        contract_id: str | None = None,
        tx_hash: str | None = None,
        status: str = STATUS_SUBMITTED,
    ) -> dict | None:
        """
        Append one submission to the chain.

        Returns the stored record, or None when the append failed.  Never
        raises: an audit-log failure must not abort the submission it records
        (the gap it leaves is itself detectable by the verifier).
        """
        if not self.database_url:
            log.warning("DATABASE_URL not configured — audit record for %s dropped", function_name)
            return None

        payload_hash = compute_payload_hash(payload)

        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    # Serialise appends: without this two writers could read the
                    # same tail and write two records with the same previous_hash.
                    cur.execute("SELECT pg_advisory_xact_lock(%s);", (_CHAIN_LOCK_KEY,))
                    cur.execute(_SELECT_TAIL_SQL)
                    tail = cur.fetchone()

                    sequence = (int(tail[0]) + 1) if tail else 1
                    previous_hash = tail[1] if tail else None
                    recorded_at = datetime.now(UTC)

                    entry_hash = compute_entry_hash(
                        sequence=sequence,
                        recorded_at=recorded_at,
                        service=service,
                        contract_id=contract_id,
                        function_name=function_name,
                        payload_hash=payload_hash,
                        tx_hash=tx_hash,
                        status=status,
                        previous_hash=previous_hash,
                    )

                    cur.execute(
                        _INSERT_SQL,
                        (
                            sequence,
                            recorded_at,
                            service,
                            contract_id,
                            function_name,
                            json.dumps(payload, default=str),
                            payload_hash,
                            tx_hash,
                            status,
                            previous_hash,
                            entry_hash,
                        ),
                    )

            record = {
                "sequence": sequence,
                "recorded_at": recorded_at,
                "service": service,
                "contract_id": contract_id,
                "function_name": function_name,
                "payload_hash": payload_hash,
                "tx_hash": tx_hash,
                "status": status,
                "previous_hash": previous_hash,
                "entry_hash": entry_hash,
            }
            log.info(
                "audit record appended",
                extra={
                    "sequence": sequence,
                    "function_name": function_name,
                    "entry_hash": entry_hash,
                },
            )
            return record

        except Exception as e:  # noqa: BLE001 — auditing is best-effort
            log.error("Failed to append audit record for %s: %s", function_name, e)
            return None

    # ── reading ──────────────────────────────────────────────────────────────

    def fetch_records(
        self, from_sequence: int = 1, limit: int | None = None
    ) -> list[dict]:
        """Read records from ``from_sequence`` upward, ordered by sequence."""
        if not self.database_url:
            return []

        sql = """
            SELECT sequence, recorded_at, service, contract_id, function_name,
                   payload_hash, tx_hash, status, previous_hash, entry_hash
              FROM oracle_audit_chain
             WHERE sequence >= %s
             ORDER BY sequence ASC
        """
        params: list[Any] = [from_sequence]
        if limit:
            sql += " LIMIT %s"
            params.append(limit)

        with psycopg2.connect(self.database_url) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(sql, params)
                return [dict(row) for row in cur.fetchall()]

    def previous_hash_before(self, sequence: int) -> str | None:
        """``entry_hash`` of the record immediately before ``sequence``."""
        if not self.database_url or sequence <= 1:
            return None
        with psycopg2.connect(self.database_url) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT entry_hash FROM oracle_audit_chain WHERE sequence = %s",
                    (sequence - 1,),
                )
                row = cur.fetchone()
                return row[0] if row else None

    def verify(self, from_sequence: int = 1) -> ChainVerification:
        """
        Verify the chain from ``from_sequence`` (default: genesis) to the head.
        """
        records = self.fetch_records(from_sequence)
        return verify_records(
            records,
            expect_genesis=(from_sequence <= 1),
            expected_previous_hash=self.previous_hash_before(from_sequence),
        )


# ── Convenience wrapper used by the oracle services ───────────────────────────

_default_chain: AuditChain | None = None


def get_chain() -> AuditChain:
    """Process-wide default chain bound to ``DATABASE_URL``."""
    global _default_chain
    if _default_chain is None:
        _default_chain = AuditChain()
    return _default_chain


def record_submission(
    service: str,
    function_name: str,
    payload: Any,
    contract_id: str | None = None,
    tx_hash: str | None = None,
    status: str = STATUS_SUBMITTED,
) -> dict | None:
    """Append a submission to the default chain.  Never raises."""
    return get_chain().record(
        service=service,
        function_name=function_name,
        payload=payload,
        contract_id=contract_id,
        tx_hash=tx_hash,
        status=status,
    )
