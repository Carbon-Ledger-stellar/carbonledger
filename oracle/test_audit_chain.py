"""
Unit tests for the tamper-evident oracle submission audit chain (#577).

Covers the three scenarios named in the issue — a normal chain, a tampered
record, and a missing record — plus the hashing primitives, the append path,
and the CLI verifier's exit codes.

The chain is built in memory by the same code that writes it to PostgreSQL
(`compute_entry_hash`), so these tests pin the real hash semantics rather than
a re-implementation of them.
"""

import os
import sys
import unittest
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from audit_chain import (  # noqa: E402
    BROKEN_LINK,
    GAP,
    GENESIS_MISMATCH,
    HASH_MISMATCH,
    STATUS_FAILED,
    AuditChain,
    canonical_json,
    compute_entry_hash,
    compute_payload_hash,
    entry_hash_for_record,
    verify_records,
)
from verify_audit_chain import EXIT_BROKEN, EXIT_ERROR, EXIT_OK  # noqa: E402
from verify_audit_chain import main as verify_main  # noqa: E402

GENESIS_TS = datetime(2026, 8, 1, 12, 0, 0, tzinfo=UTC)


def build_chain(count: int, start_sequence: int = 1, previous_hash: str | None = None) -> list[dict]:
    """Build a well-formed chain of `count` records, exactly as the DB would hold it."""
    records: list[dict] = []
    prev = previous_hash
    for i in range(count):
        sequence = start_sequence + i
        payload = {"project_id": f"proj-{sequence}", "tonnes_verified": 100 * sequence}
        record = {
            "sequence": sequence,
            "recorded_at": GENESIS_TS + timedelta(minutes=sequence),
            "service": "satellite_monitor",
            "contract_id": "CCONTRACT",
            "function_name": "submit_monitoring_data",
            "payload_hash": compute_payload_hash(payload),
            "tx_hash": f"tx{sequence}",
            "status": "submitted",
            "previous_hash": prev,
        }
        record["entry_hash"] = entry_hash_for_record(record)
        prev = record["entry_hash"]
        records.append(record)
    return records


class TestHashing(unittest.TestCase):
    """The hashing primitives every other check is built on."""

    def test_canonical_json_is_key_order_independent(self):
        assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})

    def test_canonical_json_has_no_insignificant_whitespace(self):
        assert canonical_json({"a": 1, "b": 2}) == '{"a":1,"b":2}'

    def test_payload_hash_is_stable_across_key_order(self):
        left = compute_payload_hash({"project_id": "p1", "tonnes": 10})
        right = compute_payload_hash({"tonnes": 10, "project_id": "p1"})
        assert left == right

    def test_payload_hash_changes_with_content(self):
        assert compute_payload_hash({"tonnes": 10}) != compute_payload_hash({"tonnes": 11})

    def test_payload_hash_is_sha256_hex(self):
        digest = compute_payload_hash({"a": 1})
        assert len(digest) == 64
        assert all(c in "0123456789abcdef" for c in digest)

    def test_entry_hash_depends_on_previous_hash(self):
        args = dict(
            sequence=2,
            recorded_at=GENESIS_TS,
            service="price_oracle",
            contract_id="CC",
            function_name="update_credit_price",
            payload_hash="a" * 64,
            tx_hash="tx",
            status="submitted",
        )
        assert compute_entry_hash(previous_hash="b" * 64, **args) != compute_entry_hash(
            previous_hash="c" * 64, **args
        )

    def test_entry_hash_covers_every_field(self):
        base = dict(
            sequence=1,
            recorded_at=GENESIS_TS,
            service="price_oracle",
            contract_id="CC",
            function_name="update_credit_price",
            payload_hash="a" * 64,
            tx_hash="tx",
            status="submitted",
            previous_hash=None,
        )
        baseline = compute_entry_hash(**base)
        for field, changed in [
            ("sequence", 2),
            ("recorded_at", GENESIS_TS + timedelta(seconds=1)),
            ("service", "satellite_monitor"),
            ("contract_id", "CD"),
            ("function_name", "flag_project"),
            ("payload_hash", "b" * 64),
            ("tx_hash", "tx2"),
            ("status", STATUS_FAILED),
        ]:
            mutated = {**base, field: changed}
            assert compute_entry_hash(**mutated) != baseline, f"{field} must affect the digest"


class TestNormalChain(unittest.TestCase):
    """Scenario 1: an untouched chain verifies clean."""

    def test_intact_chain_is_valid(self):
        result = verify_records(build_chain(10))
        assert result.valid
        assert result.errors == []
        assert result.checked == 10

    def test_intact_chain_reports_range_and_head(self):
        records = build_chain(5)
        result = verify_records(records)
        assert result.first_sequence == 1
        assert result.last_sequence == 5
        assert result.head_hash == records[-1]["entry_hash"]

    def test_empty_chain_is_valid(self):
        result = verify_records([])
        assert result.valid
        assert result.checked == 0

    def test_single_genesis_record_is_valid(self):
        assert verify_records(build_chain(1)).valid

    def test_slice_verification_with_supplied_link(self):
        """An auditor resuming from a checkpoint supplies the link into the slice."""
        full = build_chain(10)
        slice_ = full[5:]
        result = verify_records(
            slice_, expect_genesis=False, expected_previous_hash=full[4]["entry_hash"]
        )
        assert result.valid

    def test_slice_verification_without_link_is_flagged(self):
        """The same slice starting at sequence 6 is a gap when genesis is expected."""
        result = verify_records(build_chain(10)[5:])
        kinds = {e.kind for e in result.errors}
        assert GAP in kinds


class TestTamperedRecord(unittest.TestCase):
    """Scenario 2: a record edited after the fact."""

    def test_modified_payload_hash_is_detected(self):
        records = build_chain(6)
        records[3]["payload_hash"] = compute_payload_hash({"tonnes_verified": 999_999})

        result = verify_records(records)
        assert not result.valid
        mismatches = [e for e in result.errors if e.kind == HASH_MISMATCH]
        assert len(mismatches) == 1
        assert mismatches[0].sequence == 4

    def test_modified_tx_hash_is_detected(self):
        records = build_chain(4)
        records[1]["tx_hash"] = "tx-forged"
        result = verify_records(records)
        assert any(e.kind == HASH_MISMATCH and e.sequence == 2 for e in result.errors)

    def test_backdated_timestamp_is_detected(self):
        records = build_chain(4)
        records[2]["recorded_at"] = GENESIS_TS - timedelta(days=30)
        result = verify_records(records)
        assert any(e.kind == HASH_MISMATCH and e.sequence == 3 for e in result.errors)

    def test_status_flipped_from_failed_to_submitted_is_detected(self):
        records = build_chain(3)
        records[1]["status"] = STATUS_FAILED
        result = verify_records(records)
        assert any(e.kind == HASH_MISMATCH and e.sequence == 2 for e in result.errors)

    def test_one_tampered_record_does_not_cascade(self):
        """Verification continues from what is stored, so one edit is one error."""
        records = build_chain(8)
        records[2]["service"] = "impostor"
        result = verify_records(records)
        assert len([e for e in result.errors if e.kind == HASH_MISMATCH]) == 1

    def test_rehashed_record_still_breaks_the_link(self):
        """
        The strongest attack: edit a record AND recompute its own entry_hash.
        The edit is then self-consistent, but its successor still stores the old
        previous_hash, so the chain breaks at the seam.
        """
        records = build_chain(6)
        records[3]["payload_hash"] = compute_payload_hash({"tonnes_verified": 0})
        records[3]["entry_hash"] = entry_hash_for_record(records[3])

        result = verify_records(records)
        assert not result.valid
        broken = [e for e in result.errors if e.kind == BROKEN_LINK]
        assert broken and broken[0].sequence == 5

    def test_forged_genesis_predecessor_is_detected(self):
        records = build_chain(3)
        records[0]["previous_hash"] = "f" * 64
        result = verify_records(records)
        assert any(e.kind == GENESIS_MISMATCH for e in result.errors)


class TestMissingRecord(unittest.TestCase):
    """Scenario 3: a record deleted from the middle or the head."""

    def test_deleted_record_leaves_a_gap(self):
        records = build_chain(6)
        del records[3]  # sequence 4

        result = verify_records(records)
        assert not result.valid
        gaps = [e for e in result.errors if e.kind == GAP]
        assert len(gaps) == 1
        assert gaps[0].sequence == 5
        assert "1 record(s) missing" in gaps[0].detail

    def test_deleted_record_also_breaks_the_link(self):
        records = build_chain(6)
        del records[3]
        result = verify_records(records)
        assert any(e.kind == BROKEN_LINK and e.sequence == 5 for e in result.errors)

    def test_multiple_consecutive_deletions_report_the_span(self):
        records = build_chain(10)
        del records[3:6]  # sequences 4, 5, 6
        result = verify_records(records)
        gaps = [e for e in result.errors if e.kind == GAP]
        assert len(gaps) == 1
        assert "3 record(s) missing" in gaps[0].detail

    def test_truncated_head_is_detected(self):
        """Deleting the genesis record is caught even though nothing links to it."""
        records = build_chain(5)[1:]
        result = verify_records(records)
        gaps = [e for e in result.errors if e.kind == GAP]
        assert gaps and gaps[0].sequence == 2
        assert "expected 1" in gaps[0].detail

    def test_truncated_tail_is_not_a_gap(self):
        """
        Removing the newest records cannot be detected from the chain alone —
        the remainder is a valid prefix.  Documented here so the limitation is
        explicit: detecting tail truncation needs an external head checkpoint.
        """
        assert verify_records(build_chain(10)[:7]).valid


class TestAuditChainAppend(unittest.TestCase):
    """The write path: sequencing, linking, and failure containment."""

    def test_missing_database_url_returns_none(self):
        assert AuditChain(database_url="").record("price_oracle", "f", {"a": 1}) is None

    @patch("audit_chain.psycopg2.connect", side_effect=RuntimeError("db down"))
    def test_db_failure_is_swallowed(self, _connect):
        chain = AuditChain(database_url="postgres://x")
        assert chain.record("price_oracle", "update_credit_price", {"a": 1}) is None

    @patch("audit_chain.psycopg2.connect")
    def test_first_record_is_genesis(self, mock_connect):
        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = None  # empty table

        record = AuditChain(database_url="postgres://x").record(
            "satellite_monitor", "submit_monitoring_data", {"project_id": "p1"}
        )
        assert record["sequence"] == 1
        assert record["previous_hash"] is None
        assert record["entry_hash"] == entry_hash_for_record(record)

    @patch("audit_chain.psycopg2.connect")
    def test_subsequent_record_links_to_tail(self, mock_connect):
        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = (41, "d" * 64)

        record = AuditChain(database_url="postgres://x").record(
            "price_oracle", "update_credit_price", {"price": 12.5}
        )
        assert record["sequence"] == 42
        assert record["previous_hash"] == "d" * 64
        assert record["entry_hash"] == entry_hash_for_record(record)

    @patch("audit_chain.psycopg2.connect")
    def test_append_takes_the_advisory_lock_before_reading_the_tail(self, mock_connect):
        """Without the lock two writers could fork the chain at the same tail."""
        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = None

        AuditChain(database_url="postgres://x").record("price_oracle", "f", {"a": 1})

        statements = [call[0][0] for call in cur.execute.call_args_list]
        assert "pg_advisory_xact_lock" in statements[0]
        assert "ORDER BY sequence DESC" in statements[1]

    @patch("audit_chain.psycopg2.connect")
    def test_payload_hash_is_recorded(self, mock_connect):
        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        cur.fetchone.return_value = None

        payload = {"project_id": "p1", "tonnes_verified": 500}
        record = AuditChain(database_url="postgres://x").record(
            "satellite_monitor", "submit_monitoring_data", payload
        )
        assert record["payload_hash"] == compute_payload_hash(payload)


class TestAuditChainVerify(unittest.TestCase):
    """AuditChain.verify() stitches fetch + verify together."""

    def test_verify_reads_from_genesis_by_default(self):
        chain = AuditChain(database_url="postgres://x")
        records = build_chain(4)
        chain.fetch_records = lambda from_sequence=1, limit=None: records
        chain.previous_hash_before = lambda sequence: None

        result = chain.verify()
        assert result.valid
        assert result.checked == 4

    def test_verify_from_checkpoint_uses_stored_predecessor(self):
        full = build_chain(10)
        chain = AuditChain(database_url="postgres://x")
        chain.fetch_records = lambda from_sequence=1, limit=None: full[from_sequence - 1:]
        chain.previous_hash_before = lambda sequence: full[sequence - 2]["entry_hash"]

        assert chain.verify(from_sequence=6).valid

    def test_verify_reports_tampering(self):
        records = build_chain(5)
        records[2]["payload_hash"] = "0" * 64
        chain = AuditChain(database_url="postgres://x")
        chain.fetch_records = lambda from_sequence=1, limit=None: records
        chain.previous_hash_before = lambda sequence: None

        result = chain.verify()
        assert not result.valid
        assert result.to_dict()["errors"][0]["kind"] == HASH_MISMATCH


class TestVerifyCli(unittest.TestCase):
    """The auditor-facing CLI: exit codes and reporting."""

    @patch("verify_audit_chain.AuditChain")
    def test_intact_chain_exits_zero(self, mock_chain):
        mock_chain.return_value.verify.return_value = verify_records(build_chain(3))
        assert verify_main(["--database-url", "postgres://x"]) == EXIT_OK

    @patch("verify_audit_chain.AuditChain")
    def test_broken_chain_exits_one(self, mock_chain):
        records = build_chain(4)
        del records[1]
        mock_chain.return_value.verify.return_value = verify_records(records)
        assert verify_main(["--database-url", "postgres://x"]) == EXIT_BROKEN

    @patch.dict(os.environ, {"DATABASE_URL": ""}, clear=False)
    def test_missing_database_url_exits_two(self):
        assert verify_main([]) == EXIT_ERROR

    def test_invalid_from_sequence_exits_two(self):
        assert verify_main(["--database-url", "postgres://x", "--from-sequence", "0"]) == EXIT_ERROR

    @patch("verify_audit_chain.AuditChain")
    def test_connection_failure_exits_two(self, mock_chain):
        mock_chain.return_value.verify.side_effect = RuntimeError("connection refused")
        assert verify_main(["--database-url", "postgres://x"]) == EXIT_ERROR

    @patch("verify_audit_chain.AuditChain")
    def test_json_output_is_parsable(self, mock_chain):
        import io
        import json
        from contextlib import redirect_stdout

        mock_chain.return_value.verify.return_value = verify_records(build_chain(2))
        buffer = io.StringIO()
        with redirect_stdout(buffer):
            verify_main(["--database-url", "postgres://x", "--json"])

        payload = json.loads(buffer.getvalue())
        assert payload["valid"] is True
        assert payload["checked"] == 2


if __name__ == "__main__":
    unittest.main()
