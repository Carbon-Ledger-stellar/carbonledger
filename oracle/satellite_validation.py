"""
satellite_validation.py — validation and fraud-detection preprocessing for
incoming satellite monitoring data (issue #579).

Runs *before* the consensus engine and before anything is submitted on chain.
Three checks, in increasing order of cost:

1. **Schema validation** — required fields, types and ranges.  Malformed
   payloads are rejected with structured, per-field errors rather than a single
   opaque string, so a provider can fix their integration without guessing.

2. **Coordinate bounding box** — the observation's coordinates must fall inside
   the project's registered area, within a configurable tolerance.  A provider
   reporting the right numbers for the wrong forest is the cheapest fraud there
   is, and the cheapest to catch.

3. **Statistical anomaly detection** — a sequestration claim more than N
   standard deviations from the project's own historical mean is quarantined
   for manual review rather than rejected.  A genuine step change (a project
   expanding its area) looks identical to fraud from a single sample; that is a
   human's call, not a threshold's.

Rule-based only — machine-learning anomaly models are explicitly out of scope
per the issue, as are Soroban contract changes.

Thresholds are configurable per methodology so a high-variance methodology does
not have to share a tolerance with a low-variance one.
"""

from __future__ import annotations

import json
import math
import os
import statistics
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

import psycopg2
import psycopg2.extras
from log import get_logger

log = get_logger("satellite_validation")

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ── Config ────────────────────────────────────────────────────────────────────

#: Default tolerance, in km, by which an observation may fall outside the
#: project's registered bounding box before it is rejected.
COORDINATE_TOLERANCE_KM = float(os.environ.get("SATELLITE_COORD_TOLERANCE_KM", "1.0"))

#: Default anomaly threshold in standard deviations from the historical mean.
ANOMALY_STDDEV_THRESHOLD = float(os.environ.get("SATELLITE_ANOMALY_STDDEV", "3.0"))

#: Per-methodology overrides, e.g. '{"REDD+": 2.5, "Clean Cookstoves": 4.0}'.
#: A high-variance methodology should not share a tolerance with a low-variance
#: one; this is the knob that avoids that without a code change.
ANOMALY_THRESHOLDS_BY_METHODOLOGY: dict[str, float] = {}
_raw_thresholds = os.environ.get("SATELLITE_ANOMALY_THRESHOLDS", "").strip()
if _raw_thresholds:
    try:
        ANOMALY_THRESHOLDS_BY_METHODOLOGY = {
            str(k): float(v) for k, v in json.loads(_raw_thresholds).items()
        }
    except (ValueError, AttributeError) as e:
        log.error("Invalid SATELLITE_ANOMALY_THRESHOLDS (%s) — using defaults", e)

#: Minimum historical observations before anomaly detection means anything.
#: Below this a "3 sigma" verdict is noise, so we accept and let the history
#: build rather than quarantining every early submission.
MIN_HISTORY_SAMPLES = int(os.environ.get("SATELLITE_ANOMALY_MIN_SAMPLES", "5"))

#: Absolute ceiling on a single-period claim, as a backstop for projects with
#: no history at all.  0 disables it.
MAX_TONNES_PER_PERIOD = float(os.environ.get("SATELLITE_MAX_TONNES_PER_PERIOD", "0"))

# Decisions
ACCEPT = "accept"
REJECT = "reject"
QUARANTINE = "quarantine"

# Error codes — stable identifiers a provider can key their handling on.
MISSING_FIELD = "missing_field"
WRONG_TYPE = "wrong_type"
OUT_OF_RANGE = "out_of_range"
EMPTY_VALUE = "empty_value"
COORDINATES_MISSING = "coordinates_missing"
COORDINATES_INVALID = "coordinates_invalid"
COORDINATES_OUT_OF_BOUNDS = "coordinates_out_of_bounds"
ANOMALOUS_QUANTITY = "anomalous_quantity"
IMPLAUSIBLE_QUANTITY = "implausible_quantity"


# ── Structured errors ─────────────────────────────────────────────────────────


@dataclass
class ValidationError:
    """One structured validation failure."""

    field: str
    code: str
    message: str

    def to_dict(self) -> dict:
        return {"field": self.field, "code": self.code, "message": self.message}

    def __str__(self) -> str:
        return f"{self.field}: {self.message} ({self.code})"


@dataclass
class ValidationOutcome:
    """Verdict for one incoming satellite payload."""

    decision: str
    errors: list[ValidationError] = field(default_factory=list)
    reason: str | None = None
    stats: dict[str, Any] = field(default_factory=dict)

    @property
    def accepted(self) -> bool:
        return self.decision == ACCEPT

    @property
    def rejected(self) -> bool:
        return self.decision == REJECT

    @property
    def quarantined(self) -> bool:
        return self.decision == QUARANTINE

    def to_dict(self) -> dict:
        return {
            "decision": self.decision,
            "reason": self.reason,
            "errors": [e.to_dict() for e in self.errors],
            "stats": self.stats,
        }


# ── 1. Schema validation ──────────────────────────────────────────────────────

#: field -> (python types, required)
_SCHEMA: dict[str, tuple[tuple[type, ...], bool]] = {
    "project_id": ((str,), True),
    "period": ((str,), True),
    "satellite_cid": ((str,), True),
    "tonnes_verified": ((int, float), True),
    "methodology_score": ((int,), True),
    "content_sha256": ((str,), True),
    "coordinates": ((dict,), True),
    "methodology": ((str,), False),
    "project_type": ((str,), False),
    "deforestation_pct": ((int, float), False),
    "reported_tonnes_sequestered": ((int, float), False),
}

#: field -> (inclusive min, inclusive max)
_RANGES: dict[str, tuple[float, float]] = {
    "tonnes_verified": (0.0, float("inf")),
    "methodology_score": (0.0, 100.0),
    "deforestation_pct": (0.0, 100.0),
    "reported_tonnes_sequestered": (0.0, float("inf")),
}

_SHA256_LENGTH = 64


def validate_schema(payload: Any) -> list[ValidationError]:
    """
    Validate payload shape.  Returns every problem found, not just the first —
    a provider fixing an integration should see the whole list in one round trip.
    """
    if not isinstance(payload, dict):
        return [ValidationError("$", WRONG_TYPE, "payload must be a JSON object")]

    errors: list[ValidationError] = []

    for name, (types, required) in _SCHEMA.items():
        if name not in payload or payload[name] is None:
            if required:
                errors.append(
                    ValidationError(name, MISSING_FIELD, f"'{name}' is required")
                )
            continue

        value = payload[name]

        # bool is a subclass of int — a boolean score is a type error, not a 0/1.
        if isinstance(value, bool) and bool not in types:
            errors.append(
                ValidationError(
                    name, WRONG_TYPE, f"'{name}' must be {_type_names(types)}, got boolean"
                )
            )
            continue

        if not isinstance(value, types):
            errors.append(
                ValidationError(
                    name,
                    WRONG_TYPE,
                    f"'{name}' must be {_type_names(types)}, got {type(value).__name__}",
                )
            )
            continue

        if isinstance(value, str) and not value.strip():
            errors.append(ValidationError(name, EMPTY_VALUE, f"'{name}' must not be empty"))
            continue

        if name in _RANGES and isinstance(value, (int, float)):
            low, high = _RANGES[name]
            if not (low <= float(value) <= high):
                bound = f"{low}" if high == float("inf") else f"{low}..{high}"
                errors.append(
                    ValidationError(
                        name, OUT_OF_RANGE, f"'{name}' must be within {bound}, got {value}"
                    )
                )

    digest = payload.get("content_sha256")
    if isinstance(digest, str) and digest.strip():
        cleaned = digest.strip().lower()
        if len(cleaned) != _SHA256_LENGTH or any(c not in "0123456789abcdef" for c in cleaned):
            errors.append(
                ValidationError(
                    "content_sha256",
                    WRONG_TYPE,
                    "'content_sha256' must be a 64-character hex SHA-256 digest",
                )
            )

    return errors


def _type_names(types: tuple[type, ...]) -> str:
    return " or ".join(t.__name__ for t in types)


# ── 2. Coordinate bounding box ────────────────────────────────────────────────

#: Degrees of latitude per kilometre (constant everywhere).
_DEG_LAT_PER_KM = 1.0 / 110.574


def _deg_lon_per_km(latitude: float) -> float:
    """
    Degrees of longitude per kilometre at ``latitude``.

    Longitude lines converge toward the poles, so a fixed degrees-per-km
    conversion silently widens the tolerance with latitude: at 60°N one km is
    ~0.018° of longitude, twice the equatorial figure.  Scaling by cos(lat)
    keeps the tolerance an actual distance rather than a latitude-dependent one.
    """
    scale = math.cos(math.radians(latitude))
    if abs(scale) < 1e-6:  # at the poles longitude is meaningless
        return float("inf")
    return _DEG_LAT_PER_KM / scale


@dataclass
class BoundingBox:
    """Registered project area, normalised from whatever the registry stores."""

    min_lat: float
    max_lat: float
    min_lon: float
    max_lon: float

    def contains(self, lat: float, lon: float, tolerance_km: float = 0.0) -> bool:
        """True when (lat, lon) is inside the box, expanded by ``tolerance_km``."""
        lat_pad = tolerance_km * _DEG_LAT_PER_KM
        # Pad longitude using the latitude nearest the point, which is the
        # conservative choice (the widest padding the point could legitimately use).
        ref_lat = min(max(lat, self.min_lat), self.max_lat)
        lon_pad = tolerance_km * _deg_lon_per_km(ref_lat)

        return (
            (self.min_lat - lat_pad) <= lat <= (self.max_lat + lat_pad)
            and (self.min_lon - lon_pad) <= lon <= (self.max_lon + lon_pad)
        )

    def to_dict(self) -> dict:
        return {
            "min_lat": self.min_lat,
            "max_lat": self.max_lat,
            "min_lon": self.min_lon,
            "max_lon": self.max_lon,
        }


def parse_bounding_box(registered: Any) -> BoundingBox | None:
    """
    Normalise the registry's coordinate record into a bounding box.

    Three shapes are accepted, because projects were registered at different
    times with different conventions:

      * explicit box   — ``{min_lat, max_lat, min_lon, max_lon}``
      * point + radius — ``{lat, lon, radius_km}``
      * bare point     — ``{lat, lon}`` (degenerate box; tolerance still applies)

    Returns None when the record is missing or unusable.
    """
    if not isinstance(registered, dict):
        return None

    box_keys = ("min_lat", "max_lat", "min_lon", "max_lon")
    if all(k in registered for k in box_keys):
        try:
            min_lat, max_lat = float(registered["min_lat"]), float(registered["max_lat"])
            min_lon, max_lon = float(registered["min_lon"]), float(registered["max_lon"])
        except (TypeError, ValueError):
            return None
        # Tolerate a box recorded with its corners swapped.
        return BoundingBox(
            min(min_lat, max_lat), max(min_lat, max_lat),
            min(min_lon, max_lon), max(min_lon, max_lon),
        )

    if "lat" in registered and "lon" in registered:
        try:
            lat, lon = float(registered["lat"]), float(registered["lon"])
        except (TypeError, ValueError):
            return None

        radius_km = 0.0
        if registered.get("radius_km") is not None:
            try:
                radius_km = max(0.0, float(registered["radius_km"]))
            except (TypeError, ValueError):
                radius_km = 0.0

        lat_pad = radius_km * _DEG_LAT_PER_KM
        lon_pad = radius_km * _deg_lon_per_km(lat)
        if math.isinf(lon_pad):
            lon_pad = 180.0
        return BoundingBox(lat - lat_pad, lat + lat_pad, lon - lon_pad, lon + lon_pad)

    return None


def validate_coordinates(
    observed: Any,
    registered: Any,
    tolerance_km: float = COORDINATE_TOLERANCE_KM,
) -> list[ValidationError]:
    """Check the observation falls inside the registered area."""
    if not isinstance(observed, dict) or "lat" not in observed or "lon" not in observed:
        return [
            ValidationError(
                "coordinates",
                COORDINATES_MISSING,
                "coordinates must include numeric 'lat' and 'lon'",
            )
        ]

    try:
        lat = float(observed["lat"])
        lon = float(observed["lon"])
    except (TypeError, ValueError):
        return [
            ValidationError(
                "coordinates", COORDINATES_INVALID, "'lat' and 'lon' must be numeric"
            )
        ]

    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        return [
            ValidationError(
                "coordinates",
                COORDINATES_INVALID,
                f"lat/lon out of valid range: ({lat}, {lon})",
            )
        ]

    box = parse_bounding_box(registered)
    if box is None:
        # No registered area to compare against.  Not the provider's fault, and
        # rejecting would block every unregistered project — log and pass.
        log.warning("No usable registered bounding box — skipping coordinate check")
        return []

    if box.contains(lat, lon, tolerance_km):
        return []

    return [
        ValidationError(
            "coordinates",
            COORDINATES_OUT_OF_BOUNDS,
            f"observation ({lat}, {lon}) is outside the registered area "
            f"{box.to_dict()} even allowing {tolerance_km} km tolerance",
        )
    ]


# ── 3. Statistical anomaly detection ──────────────────────────────────────────


def threshold_for_methodology(methodology: str | None) -> float:
    """Standard-deviation threshold for ``methodology``, falling back to default."""
    if methodology and methodology in ANOMALY_THRESHOLDS_BY_METHODOLOGY:
        return ANOMALY_THRESHOLDS_BY_METHODOLOGY[methodology]
    return ANOMALY_STDDEV_THRESHOLD


@dataclass
class AnomalyVerdict:
    """Outcome of the statistical check on a sequestration claim."""

    anomalous: bool
    reason: str | None = None
    mean: float | None = None
    stdev: float | None = None
    z_score: float | None = None
    samples: int = 0
    threshold: float = ANOMALY_STDDEV_THRESHOLD

    def to_dict(self) -> dict:
        return {
            "anomalous": self.anomalous,
            "reason": self.reason,
            "mean": self.mean,
            "stdev": self.stdev,
            "z_score": self.z_score,
            "samples": self.samples,
            "threshold": self.threshold,
        }


def detect_anomaly(
    tonnes: float,
    history: Sequence[float],
    methodology: str | None = None,
    threshold: float | None = None,
    min_samples: int = MIN_HISTORY_SAMPLES,
    max_tonnes: float = MAX_TONNES_PER_PERIOD,
) -> AnomalyVerdict:
    """
    Decide whether a sequestration claim is implausible for this project.

    Pure function — no I/O — so the thresholds are directly testable.

    With fewer than ``min_samples`` historical observations the z-score is not
    meaningful, so only the absolute ceiling applies.  Quarantining every early
    submission of a new project would make the queue useless.
    """
    limit = threshold_for_methodology(methodology) if threshold is None else threshold

    if max_tonnes > 0 and tonnes > max_tonnes:
        return AnomalyVerdict(
            anomalous=True,
            reason=(
                f"claim of {tonnes} t exceeds the absolute per-period ceiling "
                f"of {max_tonnes} t"
            ),
            samples=len(history),
            threshold=limit,
        )

    if len(history) < min_samples:
        return AnomalyVerdict(
            anomalous=False,
            reason=(
                f"only {len(history)} historical observation(s); "
                f"{min_samples} needed before statistical comparison is meaningful"
            ),
            samples=len(history),
            threshold=limit,
        )

    mean = statistics.fmean(history)
    stdev = statistics.pstdev(history)

    if stdev == 0:
        # A perfectly flat history: any deviation at all is a step change.
        anomalous = not math.isclose(tonnes, mean, rel_tol=1e-9, abs_tol=1e-9)
        return AnomalyVerdict(
            anomalous=anomalous,
            reason=(
                f"history is perfectly flat at {mean} t; claim of {tonnes} t deviates"
                if anomalous
                else None
            ),
            mean=mean,
            stdev=0.0,
            z_score=None,
            samples=len(history),
            threshold=limit,
        )

    z_score = (tonnes - mean) / stdev
    anomalous = abs(z_score) > limit

    return AnomalyVerdict(
        anomalous=anomalous,
        reason=(
            f"claim of {tonnes} t is {abs(z_score):.2f} standard deviations from the "
            f"historical mean of {mean:.2f} t (threshold {limit})"
            if anomalous
            else None
        ),
        mean=mean,
        stdev=stdev,
        z_score=z_score,
        samples=len(history),
        threshold=limit,
    )


# ── History and registry lookups ──────────────────────────────────────────────


def fetch_history(project_id: str, database_url: str | None = None) -> list[float]:
    """
    Historical verified tonnes for a project, oldest first.

    Reads the backend's MonitoringData table — the same record the rest of the
    platform treats as the project's monitoring history.
    """
    dsn = database_url if database_url is not None else DATABASE_URL
    if not dsn:
        log.warning("DATABASE_URL not configured — anomaly detection has no history")
        return []

    try:
        with psycopg2.connect(dsn) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT "tonnesVerified"
                      FROM "MonitoringData"
                     WHERE "projectId" = %s
                     ORDER BY "submittedAt" ASC
                    """,
                    (project_id,),
                )
                return [float(row[0]) for row in cur.fetchall()]
    except Exception as e:  # noqa: BLE001 — missing history must not block ingestion
        log.error("Failed to read monitoring history for %s: %s", project_id, e)
        return []


# ── Quarantine queue ──────────────────────────────────────────────────────────


class QuarantineQueue:
    """
    Holds suspicious submissions for manual review.

    Quarantine is deliberately distinct from rejection: the data is retained in
    full so a reviewer can approve a genuine step change, rather than being
    discarded at the door.
    """

    def __init__(self, database_url: str | None = None) -> None:
        self.database_url = database_url if database_url is not None else DATABASE_URL

    def enqueue(
        self,
        project_id: str,
        period: str,
        payload: Any,
        reason: str,
        stats: dict | None = None,
        provider_id: str | None = None,
    ) -> bool:
        """
        Add a submission to the quarantine queue.  Returns True on success.

        Re-quarantining the same (project, period) updates the existing row
        rather than piling up duplicates for a provider that keeps retrying.
        """
        if not self.database_url:
            log.error(
                "DATABASE_URL not configured — cannot quarantine %s/%s", project_id, period
            )
            return False

        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO satellite_quarantine
                            (project_id, period, provider_id, payload, reason, stats, status)
                        VALUES (%s, %s, %s, %s, %s, %s, 'pending')
                        ON CONFLICT (project_id, period) DO UPDATE SET
                            payload      = EXCLUDED.payload,
                            reason       = EXCLUDED.reason,
                            stats        = EXCLUDED.stats,
                            provider_id  = EXCLUDED.provider_id,
                            status       = 'pending',
                            quarantined_at = NOW()
                        """,
                        (
                            project_id,
                            period,
                            provider_id,
                            json.dumps(payload, default=str),
                            reason,
                            json.dumps(stats or {}, default=str),
                        ),
                    )
            log.warning(
                "submission quarantined",
                extra={"project_id": project_id, "period": period, "reason": reason},
            )
            return True
        except Exception as e:  # noqa: BLE001
            log.error("Failed to quarantine %s/%s: %s", project_id, period, e)
            return False

    def pending(self, limit: int = 50) -> list[dict]:
        """Pending quarantine entries, newest first."""
        if not self.database_url:
            return []
        with psycopg2.connect(self.database_url) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, project_id, period, provider_id, payload, reason,
                           stats, status, quarantined_at
                      FROM satellite_quarantine
                     WHERE status = 'pending'
                     ORDER BY quarantined_at DESC
                     LIMIT %s
                    """,
                    (limit,),
                )
                return [dict(row) for row in cur.fetchall()]

    def depth(self) -> int:
        """Number of entries awaiting review."""
        if not self.database_url:
            return 0
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT COUNT(*) FROM satellite_quarantine WHERE status = 'pending'"
                    )
                    row = cur.fetchone()
                    return int(row[0]) if row else 0
        except Exception as e:  # noqa: BLE001
            log.error("Failed to read quarantine depth: %s", e)
            return 0


# ── Orchestration ─────────────────────────────────────────────────────────────


class SatelliteValidator:
    """
    Runs the three checks in order and returns a single decision.

    ``history_provider`` and ``registry_provider`` are injected so the pipeline
    is testable without a database or the backend API.
    """

    def __init__(
        self,
        history_provider: Callable[[str], Sequence[float]] | None = None,
        registry_provider: Callable[[str], Any] | None = None,
        quarantine: QuarantineQueue | None = None,
        tolerance_km: float = COORDINATE_TOLERANCE_KM,
    ) -> None:
        self.history_provider = history_provider or fetch_history
        self.registry_provider = registry_provider
        self.quarantine = quarantine or QuarantineQueue()
        self.tolerance_km = tolerance_km

    def validate_structure(
        self, payload: Any, registered_coordinates: Any = None
    ) -> ValidationOutcome:
        """
        Cheap, network-free checks: schema, then coordinates.

        Split out from :meth:`screen_anomaly` so a caller can reject malformed
        or mislocated payloads before spending an IPFS round trip on them.
        """
        schema_errors = validate_schema(payload)
        if schema_errors:
            return ValidationOutcome(
                decision=REJECT, errors=schema_errors, reason="schema_validation_failed"
            )

        registered = registered_coordinates
        if registered is None and self.registry_provider is not None:
            registered = self.registry_provider(payload["project_id"])

        coord_errors = validate_coordinates(
            payload.get("coordinates"), registered, self.tolerance_km
        )
        if coord_errors:
            return ValidationOutcome(
                decision=REJECT, errors=coord_errors, reason=COORDINATES_OUT_OF_BOUNDS
            )

        return ValidationOutcome(decision=ACCEPT)

    def screen_anomaly(
        self, payload: Any, provider_id: str | None = None
    ) -> ValidationOutcome:
        """
        Statistical screen against the project's own history.

        Quarantining is a side effect here — the caller only has to honour the
        returned decision.
        """
        project_id = payload["project_id"]
        history = list(self.history_provider(project_id))
        verdict = detect_anomaly(
            float(payload["tonnes_verified"]),
            history,
            methodology=payload.get("methodology"),
        )

        if not verdict.anomalous:
            return ValidationOutcome(decision=ACCEPT, stats=verdict.to_dict())

        self.quarantine.enqueue(
            project_id=project_id,
            period=payload["period"],
            payload=payload,
            reason=verdict.reason or "anomalous quantity",
            stats=verdict.to_dict(),
            provider_id=provider_id,
        )
        return ValidationOutcome(
            decision=QUARANTINE,
            errors=[
                ValidationError(
                    "tonnes_verified",
                    ANOMALOUS_QUANTITY,
                    verdict.reason or "anomalous quantity",
                )
            ],
            reason=ANOMALOUS_QUANTITY,
            stats=verdict.to_dict(),
        )

    def validate(
        self,
        payload: Any,
        registered_coordinates: Any = None,
        provider_id: str | None = None,
    ) -> ValidationOutcome:
        """Run the full pipeline: schema → coordinates → anomaly."""
        structure = self.validate_structure(payload, registered_coordinates)
        if not structure.accepted:
            return structure
        return self.screen_anomaly(payload, provider_id)
