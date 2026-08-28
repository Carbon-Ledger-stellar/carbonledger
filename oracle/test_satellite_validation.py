"""
Tests for the satellite validation and fraud-detection preprocessing layer (#579).

Covers the four scenarios named in the issue — valid data, schema violations,
out-of-bounds coordinates and anomalous quantities — plus the bounding-box
maths, per-methodology thresholds, and the quarantine queue.
"""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from satellite_validation import (  # noqa: E402
    ANOMALOUS_QUANTITY,
    COORDINATES_INVALID,
    COORDINATES_MISSING,
    COORDINATES_OUT_OF_BOUNDS,
    EMPTY_VALUE,
    MISSING_FIELD,
    OUT_OF_RANGE,
    WRONG_TYPE,
    BoundingBox,
    QuarantineQueue,
    SatelliteValidator,
    detect_anomaly,
    parse_bounding_box,
    validate_coordinates,
    validate_schema,
)

# A payload that passes every check, used as the base for negative cases.
VALID_PAYLOAD = {
    "project_id": "proj-001",
    "period": "2026-Q1",
    "satellite_cid": "QmValidCid",
    "tonnes_verified": 500,
    "methodology_score": 85,
    "content_sha256": "a" * 64,
    "coordinates": {"lat": 10.0, "lon": 20.0},
    "methodology": "REDD+",
}

REGISTERED_BOX = {"min_lat": 9.0, "max_lat": 11.0, "min_lon": 19.0, "max_lon": 21.0}


class FakeQuarantine:
    """In-memory stand-in for the satellite_quarantine table."""

    def __init__(self):
        self.entries: list[dict] = []

    def enqueue(self, project_id, period, payload, reason, stats=None, provider_id=None):
        self.entries.append(
            {
                "project_id": project_id,
                "period": period,
                "payload": payload,
                "reason": reason,
                "stats": stats or {},
                "provider_id": provider_id,
            }
        )
        return True


def make_validator(history=(), quarantine=None, tolerance_km=1.0):
    return SatelliteValidator(
        history_provider=lambda project_id: list(history),
        registry_provider=lambda project_id: REGISTERED_BOX,
        quarantine=quarantine or FakeQuarantine(),
        tolerance_km=tolerance_km,
    )


class TestValidData(unittest.TestCase):
    """Scenario 1: well-formed, in-bounds, unremarkable data is accepted."""

    def test_valid_payload_passes_schema(self):
        assert validate_schema(VALID_PAYLOAD) == []

    def test_valid_payload_is_accepted_end_to_end(self):
        outcome = make_validator(history=[500, 505, 495, 510, 490]).validate(VALID_PAYLOAD)
        assert outcome.accepted
        assert outcome.errors == []

    def test_optional_fields_may_be_absent(self):
        payload = {k: v for k, v in VALID_PAYLOAD.items() if k != "methodology"}
        assert validate_schema(payload) == []

    def test_float_tonnes_are_accepted(self):
        assert validate_schema({**VALID_PAYLOAD, "tonnes_verified": 500.5}) == []

    def test_zero_tonnes_is_valid(self):
        """A period with no sequestration is legitimate, not malformed."""
        assert validate_schema({**VALID_PAYLOAD, "tonnes_verified": 0}) == []


class TestSchemaViolations(unittest.TestCase):
    """Scenario 2: malformed payloads rejected with structured errors."""

    def test_missing_required_field_is_reported_by_name(self):
        payload = {k: v for k, v in VALID_PAYLOAD.items() if k != "satellite_cid"}
        errors = validate_schema(payload)
        assert len(errors) == 1
        assert errors[0].field == "satellite_cid"
        assert errors[0].code == MISSING_FIELD

    def test_all_missing_fields_are_reported_together(self):
        """One round trip should tell a provider everything that is wrong."""
        errors = validate_schema({"project_id": "p1"})
        missing = {e.field for e in errors if e.code == MISSING_FIELD}
        assert missing == {
            "period",
            "satellite_cid",
            "tonnes_verified",
            "methodology_score",
            "content_sha256",
            "coordinates",
        }

    def test_wrong_type_is_reported(self):
        errors = validate_schema({**VALID_PAYLOAD, "tonnes_verified": "five hundred"})
        assert errors[0].field == "tonnes_verified"
        assert errors[0].code == WRONG_TYPE
        assert "str" in errors[0].message

    def test_boolean_is_not_accepted_as_a_number(self):
        """bool subclasses int in Python — a boolean score is a type error."""
        errors = validate_schema({**VALID_PAYLOAD, "methodology_score": True})
        assert errors[0].code == WRONG_TYPE
        assert "boolean" in errors[0].message

    def test_negative_tonnes_is_out_of_range(self):
        errors = validate_schema({**VALID_PAYLOAD, "tonnes_verified": -1})
        assert errors[0].code == OUT_OF_RANGE

    def test_score_above_100_is_out_of_range(self):
        errors = validate_schema({**VALID_PAYLOAD, "methodology_score": 101})
        assert errors[0].code == OUT_OF_RANGE

    def test_empty_string_is_rejected(self):
        errors = validate_schema({**VALID_PAYLOAD, "project_id": "   "})
        assert errors[0].code == EMPTY_VALUE

    def test_malformed_sha256_is_rejected(self):
        errors = validate_schema({**VALID_PAYLOAD, "content_sha256": "nothex"})
        assert errors[0].field == "content_sha256"
        assert errors[0].code == WRONG_TYPE

    def test_non_object_payload_is_rejected(self):
        errors = validate_schema(["not", "an", "object"])
        assert errors[0].code == WRONG_TYPE

    def test_errors_serialise_for_the_http_response(self):
        errors = validate_schema({**VALID_PAYLOAD, "tonnes_verified": -5})
        payload = errors[0].to_dict()
        assert set(payload) == {"field", "code", "message"}

    def test_schema_failure_short_circuits_the_pipeline(self):
        """A malformed payload must not cost a history lookup."""
        looked_up = []
        validator = SatelliteValidator(
            history_provider=lambda pid: looked_up.append(pid) or [],
            registry_provider=lambda pid: REGISTERED_BOX,
            quarantine=FakeQuarantine(),
        )
        outcome = validator.validate({"project_id": "p1"})
        assert outcome.rejected
        assert looked_up == []


class TestBoundingBox(unittest.TestCase):
    """Bounding-box normalisation and containment maths."""

    def test_explicit_box_is_parsed(self):
        box = parse_bounding_box(REGISTERED_BOX)
        assert box == BoundingBox(9.0, 11.0, 19.0, 21.0)

    def test_swapped_corners_are_normalised(self):
        box = parse_bounding_box(
            {"min_lat": 11.0, "max_lat": 9.0, "min_lon": 21.0, "max_lon": 19.0}
        )
        assert box == BoundingBox(9.0, 11.0, 19.0, 21.0)

    def test_point_with_radius_becomes_a_box(self):
        box = parse_bounding_box({"lat": 10.0, "lon": 20.0, "radius_km": 10.0})
        assert box.min_lat < 10.0 < box.max_lat
        assert box.min_lon < 20.0 < box.max_lon

    def test_bare_point_is_a_degenerate_box(self):
        box = parse_bounding_box({"lat": 10.0, "lon": 20.0})
        assert box == BoundingBox(10.0, 10.0, 20.0, 20.0)

    def test_unusable_record_returns_none(self):
        assert parse_bounding_box(None) is None
        assert parse_bounding_box({}) is None
        assert parse_bounding_box({"lat": "north"}) is None

    def test_point_inside_box_is_contained(self):
        assert BoundingBox(9.0, 11.0, 19.0, 21.0).contains(10.0, 20.0)

    def test_point_outside_box_is_not_contained(self):
        assert not BoundingBox(9.0, 11.0, 19.0, 21.0).contains(50.0, 20.0)

    def test_tolerance_expands_the_box(self):
        box = BoundingBox(9.0, 11.0, 19.0, 21.0)
        just_outside = 11.005  # ~0.55 km north of the edge
        assert not box.contains(just_outside, 20.0, tolerance_km=0.0)
        assert box.contains(just_outside, 20.0, tolerance_km=1.0)

    def test_longitude_tolerance_scales_with_latitude(self):
        """
        Longitude lines converge toward the poles. A fixed degrees-per-km
        conversion would silently widen the tolerance with latitude; scaling by
        cos(lat) keeps it an actual distance.
        """
        equator = BoundingBox(0.0, 0.0, 0.0, 0.0)
        high_lat = BoundingBox(60.0, 60.0, 0.0, 0.0)

        # 1 km east at the equator is ~0.009 deg; at 60 deg it is ~0.018 deg.
        assert equator.contains(0.0, 0.0089, tolerance_km=1.0)
        assert not equator.contains(0.0, 0.0179, tolerance_km=1.0)
        assert high_lat.contains(60.0, 0.0179, tolerance_km=1.0)


class TestCoordinateValidation(unittest.TestCase):
    """Scenario 3: observations for the wrong location are rejected."""

    def test_in_bounds_coordinates_pass(self):
        assert validate_coordinates({"lat": 10.0, "lon": 20.0}, REGISTERED_BOX) == []

    def test_out_of_bounds_coordinates_are_rejected(self):
        errors = validate_coordinates({"lat": 45.0, "lon": 20.0}, REGISTERED_BOX)
        assert errors[0].code == COORDINATES_OUT_OF_BOUNDS
        assert "45.0" in errors[0].message

    def test_missing_coordinates_are_reported(self):
        errors = validate_coordinates({}, REGISTERED_BOX)
        assert errors[0].code == COORDINATES_MISSING

    def test_non_numeric_coordinates_are_reported(self):
        errors = validate_coordinates({"lat": "north", "lon": 20.0}, REGISTERED_BOX)
        assert errors[0].code == COORDINATES_INVALID

    def test_impossible_latitude_is_reported(self):
        errors = validate_coordinates({"lat": 91.0, "lon": 20.0}, REGISTERED_BOX)
        assert errors[0].code == COORDINATES_INVALID

    def test_impossible_longitude_is_reported(self):
        errors = validate_coordinates({"lat": 10.0, "lon": 181.0}, REGISTERED_BOX)
        assert errors[0].code == COORDINATES_INVALID

    def test_unregistered_project_skips_the_check(self):
        """Rejecting here would block every project without registry coordinates."""
        assert validate_coordinates({"lat": 45.0, "lon": 90.0}, None) == []

    def test_tolerance_is_configurable(self):
        just_outside = {"lat": 11.02, "lon": 20.0}  # ~2.2 km north of the edge
        assert validate_coordinates(just_outside, REGISTERED_BOX, tolerance_km=1.0)
        assert validate_coordinates(just_outside, REGISTERED_BOX, tolerance_km=5.0) == []

    def test_out_of_bounds_is_rejected_end_to_end(self):
        outcome = make_validator().validate({**VALID_PAYLOAD, "coordinates": {"lat": 45.0, "lon": 90.0}})
        assert outcome.rejected
        assert outcome.reason == COORDINATES_OUT_OF_BOUNDS


class TestAnomalyDetection(unittest.TestCase):
    """Scenario 4: implausible sequestration claims are quarantined."""

    HISTORY = [500.0, 510.0, 495.0, 505.0, 500.0, 490.0]

    def test_typical_claim_is_not_anomalous(self):
        verdict = detect_anomaly(503.0, self.HISTORY, threshold=3.0)
        assert not verdict.anomalous
        assert verdict.samples == 6

    def test_wildly_high_claim_is_anomalous(self):
        verdict = detect_anomaly(50_000.0, self.HISTORY, threshold=3.0)
        assert verdict.anomalous
        assert "standard deviations" in verdict.reason

    def test_wildly_low_claim_is_also_anomalous(self):
        """A collapse is as much a red flag as a spike."""
        verdict = detect_anomaly(0.0, self.HISTORY, threshold=3.0)
        assert verdict.anomalous

    def test_z_score_is_reported(self):
        verdict = detect_anomaly(50_000.0, self.HISTORY, threshold=3.0)
        assert verdict.z_score > 3.0
        assert verdict.mean is not None
        assert verdict.stdev is not None

    def test_threshold_is_respected(self):
        history = [100.0] * 5 + [110.0] * 5
        claim = 130.0
        assert detect_anomaly(claim, history, threshold=1.0).anomalous
        assert not detect_anomaly(claim, history, threshold=10.0).anomalous

    def test_short_history_suppresses_detection(self):
        """
        With too few samples a 3-sigma verdict is noise. Quarantining every
        early submission of a new project would make the queue useless.
        """
        verdict = detect_anomaly(999_999.0, [500.0, 505.0], min_samples=5)
        assert not verdict.anomalous
        assert "historical observation" in verdict.reason

    def test_empty_history_suppresses_detection(self):
        assert not detect_anomaly(500.0, [], min_samples=5).anomalous

    def test_absolute_ceiling_applies_without_history(self):
        """The backstop for projects with no history at all."""
        verdict = detect_anomaly(1_000_000.0, [], max_tonnes=100_000.0)
        assert verdict.anomalous
        assert "ceiling" in verdict.reason

    def test_absolute_ceiling_is_disabled_by_default(self):
        assert not detect_anomaly(1_000_000.0, [], max_tonnes=0).anomalous

    def test_flat_history_treats_any_change_as_a_step(self):
        verdict = detect_anomaly(600.0, [500.0] * 6)
        assert verdict.anomalous
        assert "perfectly flat" in verdict.reason

    def test_flat_history_accepts_an_identical_claim(self):
        assert not detect_anomaly(500.0, [500.0] * 6).anomalous

    @patch.dict(
        "satellite_validation.ANOMALY_THRESHOLDS_BY_METHODOLOGY",
        {"Clean Cookstoves": 10.0},
        clear=True,
    )
    def test_threshold_is_configurable_per_methodology(self):
        """A high-variance methodology should not share a low-variance tolerance."""
        history = [100.0] * 5 + [110.0] * 5  # mean 105, stdev 5
        claim = 130.0  # z = 5.0 — past the 3-sigma default, inside a 10-sigma override
        assert detect_anomaly(claim, history, methodology="REDD+").anomalous
        assert not detect_anomaly(claim, history, methodology="Clean Cookstoves").anomalous


class TestQuarantineFlow(unittest.TestCase):
    """Anomalous data is held for review, not discarded."""

    HISTORY = [500.0, 510.0, 495.0, 505.0, 500.0, 490.0]

    def test_anomalous_payload_is_quarantined_not_rejected(self):
        quarantine = FakeQuarantine()
        validator = make_validator(history=self.HISTORY, quarantine=quarantine)
        outcome = validator.validate({**VALID_PAYLOAD, "tonnes_verified": 90_000})

        assert outcome.quarantined
        assert not outcome.rejected
        assert outcome.reason == ANOMALOUS_QUANTITY

    def test_quarantine_entry_retains_the_full_payload(self):
        quarantine = FakeQuarantine()
        validator = make_validator(history=self.HISTORY, quarantine=quarantine)
        payload = {**VALID_PAYLOAD, "tonnes_verified": 90_000}
        validator.validate(payload, provider_id="planet_labs")

        assert len(quarantine.entries) == 1
        entry = quarantine.entries[0]
        assert entry["payload"] == payload
        assert entry["project_id"] == "proj-001"
        assert entry["period"] == "2026-Q1"
        assert entry["provider_id"] == "planet_labs"

    def test_quarantine_entry_records_the_statistics(self):
        quarantine = FakeQuarantine()
        validator = make_validator(history=self.HISTORY, quarantine=quarantine)
        validator.validate({**VALID_PAYLOAD, "tonnes_verified": 90_000})

        stats = quarantine.entries[0]["stats"]
        assert stats["anomalous"] is True
        assert stats["mean"] is not None
        assert stats["z_score"] is not None
        assert stats["threshold"] is not None

    def test_normal_payload_is_not_quarantined(self):
        quarantine = FakeQuarantine()
        validator = make_validator(history=self.HISTORY, quarantine=quarantine)
        assert validator.validate(VALID_PAYLOAD).accepted
        assert quarantine.entries == []

    def test_rejected_payload_is_not_quarantined(self):
        """Malformed data is a provider bug, not something a human should review."""
        quarantine = FakeQuarantine()
        validator = make_validator(history=self.HISTORY, quarantine=quarantine)
        validator.validate({**VALID_PAYLOAD, "tonnes_verified": -1})
        assert quarantine.entries == []


class TestQuarantineQueueStorage(unittest.TestCase):
    """The Postgres-backed queue."""

    def test_missing_database_url_returns_false(self):
        queue = QuarantineQueue(database_url="")
        assert queue.enqueue("p1", "2026-Q1", {}, "reason") is False

    @patch("satellite_validation.psycopg2.connect", side_effect=RuntimeError("db down"))
    def test_db_failure_is_swallowed(self, _connect):
        queue = QuarantineQueue(database_url="postgres://x")
        assert queue.enqueue("p1", "2026-Q1", {}, "reason") is False

    @patch("satellite_validation.psycopg2.connect")
    def test_enqueue_upserts_on_project_and_period(self, mock_connect):
        """A provider that keeps retrying must not pile up duplicate reviews."""
        queue = QuarantineQueue(database_url="postgres://x")
        assert queue.enqueue("p1", "2026-Q1", {"a": 1}, "anomalous") is True

        cur = mock_connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        sql = cur.execute.call_args[0][0]
        assert "ON CONFLICT (project_id, period) DO UPDATE" in sql

    @patch("satellite_validation.psycopg2.connect", side_effect=RuntimeError("db down"))
    def test_depth_failure_returns_zero(self, _connect):
        assert QuarantineQueue(database_url="postgres://x").depth() == 0


class TestPipelineStages(unittest.TestCase):
    """validate_structure / screen_anomaly split, used by the webhook."""

    def test_structure_stage_does_not_touch_history(self):
        looked_up = []
        validator = SatelliteValidator(
            history_provider=lambda pid: looked_up.append(pid) or [],
            registry_provider=lambda pid: REGISTERED_BOX,
            quarantine=FakeQuarantine(),
        )
        assert validator.validate_structure(VALID_PAYLOAD).accepted
        assert looked_up == []

    def test_structure_stage_uses_supplied_coordinates_over_the_registry(self):
        validator = SatelliteValidator(
            history_provider=lambda pid: [],
            registry_provider=lambda pid: {"min_lat": 80, "max_lat": 81, "min_lon": 80, "max_lon": 81},
            quarantine=FakeQuarantine(),
        )
        assert validator.validate_structure(VALID_PAYLOAD, REGISTERED_BOX).accepted

    def test_anomaly_stage_alone_quarantines(self):
        quarantine = FakeQuarantine()
        validator = make_validator(history=[500.0] * 6, quarantine=quarantine)
        outcome = validator.screen_anomaly({**VALID_PAYLOAD, "tonnes_verified": 90_000})
        assert outcome.quarantined
        assert len(quarantine.entries) == 1


if __name__ == "__main__":
    unittest.main()
