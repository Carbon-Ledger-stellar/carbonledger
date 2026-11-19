"""
Consensus Engine for Multi-Source Satellite Data

Requires agreement from at least N-of-M independent satellite data
providers before submitting monitoring data on-chain, preventing a
single compromised source from triggering fraudulent credit issuance.

Providers supported (configurable):
  - google_earth_engine  (GEE)
  - planet_labs          (Planet)
  - sentinel_hub         (Copernicus/Sentinel)

Quorum is configurable via QUORUM_N and QUORUM_M env vars (default: 2-of-3).
Conflicting observations trigger an alert and block submission.
"""

import os
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple
from enum import Enum

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

QUORUM_N = int(os.environ.get("QUORUM_N", 2))
QUORUM_M = int(os.environ.get("QUORUM_M", 3))
QUORUM_TONNAGE_TOLERANCE_PCT = float(
    os.environ.get("QUORUM_TONNAGE_TOLERANCE_PCT", 5.0)
)
QUORUM_SCORE_TOLERANCE_PCT = float(
    os.environ.get("QUORUM_SCORE_TOLERANCE_PCT", 10.0)
)
QUORUM_SOURCE_TIMEOUT_S = int(os.environ.get("QUORUM_SOURCE_TIMEOUT_S", 30))
QUORUM_ALERT_WEBHOOK = os.environ.get("QUORUM_ALERT_WEBHOOK", "")


class Provider(Enum):
    GOOGLE_EARTH_ENGINE = "google_earth_engine"
    PLANET_LABS = "planet_labs"
    SENTINEL_HUB = "sentinel_hub"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class Observation:
    provider: str
    project_id: str
    period: str
    tonnes_verified: float
    methodology_score: int
    satellite_cid: str
    coordinates: dict = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    available: bool = True


@dataclass
class ConsensusResult:
    quorum_met: bool
    providers_count: int
    consensus_tonnes: float
    consensus_score: int
    consensus_cid: str
    conflicting_providers: List[str]
    alert_triggered: bool
    detail: str


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

def _tonnage_within_tolerance(a: float, b: float, tolerance_pct: float) -> bool:
    """Return True when two tonnage values are within ``tolerance_pct`` of each other.

    The relative difference is computed against the larger magnitude of the
    two values, so the comparison is symmetric. Two zero values are treated
    as agreeing; a zero paired with a non-zero value is treated as a conflict.

    Args:
        a: First tonnage value.
        b: Second tonnage value.
        tolerance_pct: Maximum allowed relative difference, in percent.

    Returns:
        True if the values agree within tolerance, otherwise False.
    """
    if a == 0 and b == 0:
        return True
    if a == 0 or b == 0:
        return False
    diff = abs(a - b) / max(abs(a), abs(b)) * 100
    return diff <= tolerance_pct


def _score_within_tolerance(a: int, b: int, tolerance_pct: float) -> bool:
    """Return True when two methodology scores are within ``tolerance_pct`` of each other.

    Uses the same symmetric relative-difference rule as
    :func:`_tonnage_within_tolerance`: both zero agrees, zero vs non-zero
    conflicts, otherwise the difference is measured against the larger value.

    Args:
        a: First methodology score.
        b: Second methodology score.
        tolerance_pct: Maximum allowed relative difference, in percent.

    Returns:
        True if the scores agree within tolerance, otherwise False.
    """
    if a == 0 and b == 0:
        return True
    if a == 0 or b == 0:
        return False
    diff = abs(a - b) / max(abs(a), abs(b)) * 100
    return diff <= tolerance_pct


def _detect_conflicts(
    observations: List[Observation],
    tonnage_tolerance_pct: float = QUORUM_TONNAGE_TOLERANCE_PCT,
    score_tolerance_pct: float = QUORUM_SCORE_TOLERANCE_PCT,
) -> Tuple[List[str], Optional[Observation]]:
    """Detect conflicting (outlier) observations among the provider set.

    Outlier rejection is pairwise: every observation is compared against every
    other observation on both tonnage (``tonnage_tolerance_pct``) and
    methodology score (``score_tolerance_pct``). Any observation that falls
    outside tolerance of *any* peer is marked as conflicting, regardless of
    which side of the disagreement it is on. This is intentionally
    conservative — a single deviating provider cannot silently drag the
    consensus, and a genuine split produces no consensus at all.

    The consensus observation is then chosen from the *non-conflicting*
    observations only, as the one with the highest ``methodology_score``.
    If every observation is conflicting, no consensus exists and ``None`` is
    returned so the caller can block submission.

    Args:
        observations: Observations to compare (typically the reporting set).
        tonnage_tolerance_pct: Max relative tonnage difference, in percent.
        score_tolerance_pct: Max relative methodology-score difference, in percent.

    Returns:
        A tuple ``(conflicting_provider_ids, consensus_observation)`` where
        ``conflicting_provider_ids`` lists the provider names that deviate from
        their peers and ``consensus_observation`` is the winning observation,
        or ``None`` if no non-conflicting observation remains.
    """
    # A single observation (or none) cannot conflict with anything.
    if len(observations) <= 1:
        return [], (observations[0] if observations else None)

    conflicting: List[str] = []

    # Pairwise comparison: flag any observation that deviates from any peer on
    # either tonnage or methodology score. Each provider is recorded at most
    # once even if it conflicts on both dimensions or with multiple peers.
    for i, obs in enumerate(observations):
        for j, other in enumerate(observations):
            if i == j:
                continue
            if not _tonnage_within_tolerance(
                obs.tonnes_verified, other.tonnes_verified, tonnage_tolerance_pct
            ):
                if obs.provider not in conflicting:
                    conflicting.append(obs.provider)
            if not _score_within_tolerance(
                obs.methodology_score, other.methodology_score, score_tolerance_pct
            ):
                if obs.provider not in conflicting:
                    conflicting.append(obs.provider)

    # Consensus = the highest-methodology-score observation among those that
    # did not conflict with any peer. If none remain, consensus is None and the
    # caller must block submission.
    non_conflicting = [
        obs for obs in observations if obs.provider not in conflicting
    ]
    consensus = None
    if non_conflicting:
        consensus = max(non_conflicting, key=lambda o: o.methodology_score)

    return conflicting, consensus


# ---------------------------------------------------------------------------
# Consensus engine
# ---------------------------------------------------------------------------

class ConsensusEngine:
    """
    N-of-M consensus engine for satellite monitoring data.

    Collects observations from configured satellite providers,
    validates that at least N providers agree within tolerance,
    detects conflicts, and gates on-chain submission.
    """

    def __init__(
        self,
        n: int = QUORUM_N,
        m: int = QUORUM_M,
        providers: Optional[List[str]] = None,
        timeout_s: int = QUORUM_SOURCE_TIMEOUT_S,
    ):
        """Create a consensus engine.

        Args:
            n: Minimum number of agreeing providers required (quorum N).
            m: Total number of configured providers (quorum M).
            providers: Provider identifiers to track. Defaults to all
                :class:`Provider` values.
            timeout_s: Per-source collection timeout, in seconds.
        """
        self.n = n
        self.m = m
        self.providers = providers or [p.value for p in Provider]
        self.timeout_s = timeout_s
        self._observations: Dict[str, Observation] = {}

    def register_observation(self, obs: Observation) -> None:
        """Record (or replace) an observation from a provider.

        Args:
            obs: The observation to store, keyed by ``obs.provider``.
        """
        self._observations[obs.provider] = obs

    def register_provider(self, provider_id: str) -> None:
        """Ensure a provider is tracked even if no observation has arrived yet.

        Registers an unavailable placeholder observation so the provider counts
        toward the configured set but not toward the reporting quorum.

        Args:
            provider_id: Identifier of the provider to track.
        """
        if provider_id not in self._observations:
            self._observations[provider_id] = Observation(
                provider=provider_id,
                project_id="",
                period="",
                tonnes_verified=0,
                methodology_score=0,
                satellite_cid="",
                available=False,
            )

    def evaluate(self, project_id: str, period: str) -> ConsensusResult:
        """
        Evaluate collected observations and return a consensus result.

        Steps:
          1. Check that at least N of M providers have reported.
          2. Detect conflicts among the reporting providers.
          3. If conflicts exist and quorum cannot be reached, block submission.
          4. If quorum is met, return the consensus observation for on-chain submission.

        Args:
            project_id: Project whose observations should be evaluated.
            period: Monitoring period to evaluate (e.g. ``"2024-Q1"``).

        Returns:
            A :class:`ConsensusResult`. ``quorum_met`` is False (and submission
            is blocked) when fewer than N providers reported or when the
            reporting providers conflict with no majority agreement. When
            quorum is met, ``consensus_tonnes``/``consensus_score``/
            ``consensus_cid`` carry the winning observation's values.
        """
        # Reporting set: only available observations for this project/period
        # count toward quorum. Placeholders and other periods are excluded.
        reporting = [
            obs for obs in self._observations.values()
            if obs.available and obs.project_id == project_id and obs.period == period
        ]
        total_configured = len(self.providers)

        # ── Quorum check ──────────────────────────────────────────────
        # Quorum is met when the number of reporting providers is at least N.
        # If not, derive the unavailable providers (configured providers that
        # did not appear in the reporting set) for the alert/detail message.
        if len(reporting) < self.n:
            unavailable = [
                p for p in self.providers
                if p not in {obs.provider for obs in reporting}
            ]
            detail = (
                f"Quorum NOT met: {len(reporting)}/{self.n} required "
                f"({len(reporting)} of {total_configured} providers reported). "
                f"Unavailable: {unavailable}"
            )
            logger.warning("CONSENSUS: %s", detail)
            self._fire_alert("quorum_not_met", detail, project_id, period)
            return ConsensusResult(
                quorum_met=False,
                providers_count=len(reporting),
                consensus_tonnes=0,
                consensus_score=0,
                consensus_cid="",
                conflicting_providers=[],
                alert_triggered=True,
                detail=detail,
            )

        # ── Conflict detection ────────────────────────────────────────
        # Outliers are rejected pairwise; a consensus exists only if at least
        # one observation did not conflict with any peer.
        conflicting, consensus = _detect_conflicts(reporting)

        # No non-conflicting observation remains: block submission entirely.
        if conflicting and consensus is None:
            detail = (
                f"CONSENSUS BLOCKED: conflicting data from providers "
                f"{conflicting} for project {project_id}/{period}. "
                f"No majority agreement within tolerance."
            )
            logger.error("CONSENSUS: %s", detail)
            self._fire_alert("conflict_detected", detail, project_id, period)
            return ConsensusResult(
                quorum_met=False,
                providers_count=len(reporting),
                consensus_tonnes=0,
                consensus_score=0,
                consensus_cid="",
                conflicting_providers=conflicting,
                alert_triggered=True,
                detail=detail,
            )

        # Some providers conflicted but a majority still agreed: proceed with
        # the consensus values and raise a warning alert.
        if conflicting:
            detail = (
                f"CONSENSUS WARNING: {len(conflicting)} provider(s) "
                f"conflicting ({', '.join(conflicting)}), but "
                f"majority ({len(reporting) - len(conflicting)}/{len(reporting)}) agreed. "
                f"Proceeding with consensus values."
            )
            logger.warning("CONSENSUS: %s", detail)
            self._fire_alert("conflict_minority", detail, project_id, period)
        else:
            detail = (
                f"CONSENSUS OK: all {len(reporting)} providers agreed for "
                f"project {project_id}/{period}."
            )
            logger.info("CONSENSUS: %s", detail)

        return ConsensusResult(
            quorum_met=True,
            providers_count=len(reporting),
            consensus_tonnes=consensus.tonnes_verified if consensus else 0,
            consensus_score=consensus.methodology_score if consensus else 0,
            consensus_cid=consensus.satellite_cid if consensus else "",
            conflicting_providers=conflicting,
            alert_triggered=bool(conflicting),
            detail=detail,
        )

    def reset(self) -> None:
        """Clear all collected observations (useful between evaluation rounds)."""
        self._observations.clear()

    def _fire_alert(self, alert_type: str, message: str, project_id: str, period: str) -> None:
        """Send an alert to the configured webhook, if one is set.

        No-op when ``QUORUM_ALERT_WEBHOOK`` is empty. Delivery failures are
        logged and never raised, so alerting cannot block consensus evaluation.

        Args:
            alert_type: Short machine-readable alert category.
            message: Human-readable alert detail.
            project_id: Project the alert relates to.
            period: Monitoring period the alert relates to.
        """
        if not QUORUM_ALERT_WEBHOOK:
            return
        import json
        import urllib.request

        payload = json.dumps({
            "event": "consensus_alert",
            "alert_type": alert_type,
            "project_id": project_id,
            "period": period,
            "message": message,
            "quorum_n": self.n,
            "quorum_m": self.m,
            "providers_reported": self._count_reporting(),
            "timestamp": time.time(),
        }).encode()

        req = urllib.request.Request(
            QUORUM_ALERT_WEBHOOK,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                logger.info("Consensus alert delivered: HTTP %d", resp.status)
        except Exception as exc:
            logger.error("Failed to fire consensus alert webhook: %s", exc)

    def _count_reporting(self) -> int:
        """Return the number of currently available (reporting) observations."""
        return sum(1 for obs in self._observations.values() if obs.available)


def get_consensus_engine() -> ConsensusEngine:
    """Return a ConsensusEngine instance configured from environment variables.

    Reads ``QUORUM_N`` and ``QUORUM_M`` (defaults 2-of-3).

    Returns:
        A new :class:`ConsensusEngine` built from the current env config.
    """
    return ConsensusEngine(n=QUORUM_N, m=QUORUM_M)


# ---------------------------------------------------------------------------
# Convenience helpers for satellite_monitor integration
# ---------------------------------------------------------------------------

def quorum_required_data(
    project_id: str,
    period: str,
    observations: List[Observation],
    n: int = QUORUM_N,
    m: int = QUORUM_M,
) -> Tuple[bool, Optional[Observation], str]:
    """
    Quick-evaluate a set of observations against an N-of-M quorum.

    Applies the same rules as :meth:`ConsensusEngine.evaluate`: at least ``n``
    providers must report, and outliers are rejected pairwise. Submission is
    blocked (``quorum_met`` False) when fewer than ``n`` providers report or
    when the reporting providers conflict with no majority agreement.

    Args:
        project_id: Project whose observations should be evaluated.
        period: Monitoring period to evaluate.
        observations: Candidate observations to evaluate.
        n: Minimum number of reporting providers required.
        m: Total number of configured providers.

    Returns:
        A tuple ``(quorum_met, consensus_observation, detail_message)`` where
        ``consensus_observation`` is ``None`` when quorum is not met or
        submission is blocked.
    """
    # Only available observations for this project/period count toward quorum.
    reporting = [
        obs for obs in observations
        if obs.available
        and obs.project_id == project_id
        and obs.period == period
    ]

    # Quorum check: fewer than N reporting providers blocks submission.
    if len(reporting) < n:
        return (
            False,
            None,
            f"Quorum NOT met: {len(reporting)}/{n} required "
            f"({len(reporting)} of {m} providers reported)",
        )

    # Outlier rejection: no non-conflicting observation means no consensus.
    conflicting, consensus = _detect_conflicts(reporting)

    if conflicting and consensus is None:
        return (
            False,
            None,
            f"CONSENSUS BLOCKED: conflicting data from {conflicting}",
        )

    return (
        True,
        consensus,
        f"Quorum met: {len(reporting)}/{m} providers, "
        f"{len(conflicting)} conflicting",
    )