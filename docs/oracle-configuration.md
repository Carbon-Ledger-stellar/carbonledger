# Oracle Configuration Guide

## Consensus Engine (Quorum)

The satellite monitor uses a consensus engine to prevent a single compromised data source from
submitting fraudulent monitoring data on-chain. The engine requires agreement from at least
**N-of-M** independent satellite providers before any `submit_monitoring_data()` call.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `QUORUM_N` | `2` | Minimum number of providers that must agree |
| `QUORUM_M` | `3` | Total number of configured providers |
| `QUORUM_TONNAGE_TOLERANCE_PCT` | `5.0` | Max % tonnage deviation for conflict detection |
| `QUORUM_SCORE_TOLERANCE_PCT` | `10.0` | Max % score deviation for conflict detection |
| `QUORUM_SOURCE_TIMEOUT_S` | `30` | Timeout in seconds for source availability |
| `QUORUM_ALERT_WEBHOOK` | *(none)* | URL for consensus alert POST payloads |

### Supported Providers

| Provider ID | Description |
|---|---|
| `google_earth_engine` | Google Earth Engine satellite imagery |
| `planet_labs` | Planet Labs satellite imagery |
| `sentinel_hub` | Sentinel Hub (Copernicus) satellite data |

### How It Works

1. **Observation collection** — Each satellite provider submits monitoring data via its own webhook.
   The consensus engine records each observation tagged with the provider ID.

2. **Quorum check** — If fewer than `QUORUM_N` providers have reported, submission is blocked
   and an alert is fired.

3. **Conflict detection** — Each pair of observations is compared:
   - **Tonnage**: if the difference exceeds `QUORUM_TONNAGE_TOLERANCE_PCT` of the larger value,
     it is flagged as conflicting.
   - **Score**: if the difference exceeds `QUORUM_SCORE_TOLERANCE_PCT` of the larger value,
     it is flagged as conflicting.

4. **Consensus resolution** — If a majority (all-but-outlier) agree, the consensus observation
   (highest methodology_score among non-conflicting) is used for on-chain submission.

5. **Conflict blocking** — If ALL providers conflict and no majority can be established,
   the submission is **blocked** and an alert is triggered.

### Example: 2-of-3 Quorum

```
Providers: GEE, Planet, Sentinel Hub
Quorum: 2 of 3 (default)

Scenario A: All agree
  GEE:   tonnes=1000, score=80
  Planet: tonnes=1005, score=82  ← within 5% tonnage tolerance
  Sentinel: tonnes=995, score=79  ← within 5% tonnage tolerance
  Result: ✅ Quorum met, no conflicts, consensus submitted

Scenario B: One disagrees
  GEE:   tonnes=1000, score=80
  Planet: tonnes=5000, score=82  ← 300% deviation → outlier
  Sentinel: tonnes=1005, score=79
  Result: ⚠️ Quorum met (2/3 agree), conflict detected for Planet Labs,
          consensus uses GEE+Sentinel values, alert fired

Scenario C: All conflict
  GEE:   tonnes=1000, score=80
  Planet: tonnes=5000, score=95  ← outlier on both axes
  Sentinel: tonnes=200, score=10  ← outlier on both axes
  Result: ❌ Quorum blocked, no submission, alert fired

Scenario D: Source unavailable
  GEE:   tonnes=1000, score=80
  Planet: UNAVAILABLE (timeout)
  Sentinel: tonnes=995, score=79
  Result: ✅ Quorum met (2/2 available), GEE+Sentinel values used
```

### On-Chain Integration

The `satellite_monitor.py` webhook endpoint calls the consensus engine before
submitting to the oracle contract. If quorum is met and no blocking conflict
exists, `submit_monitoring_data` is invoked on-chain with the consensus values.

### Alert Payloads

When `QUORUM_ALERT_WEBHOOK` is configured, the engine POSTs JSON alerts:

```json
{
  "event": "consensus_alert",
  "alert_type": "conflict_detected" | "quorum_not_met" | "conflict_minority",
  "project_id": "proj-test",
  "period": "2024-Q1",
  "message": "CONSENSUS BLOCKED: conflicting data from ['planet_labs']",
  "quorum_n": 2,
  "quorum_m": 3,
  "providers_reported": 3,
  "timestamp": 1722345678.123
}
```

---

## Satellite Validation and Fraud Detection (Issue #579)

Incoming satellite data passes through
[`SatelliteValidator`](../oracle/satellite_validation.py) before it reaches the
consensus engine or the oracle contract. Three checks run in increasing order
of cost, so a malformed payload never costs an IPFS round trip.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `SATELLITE_COORD_TOLERANCE_KM` | `1.0` | How far outside the registered area an observation may fall |
| `SATELLITE_ANOMALY_STDDEV` | `3.0` | Default anomaly threshold in standard deviations |
| `SATELLITE_ANOMALY_THRESHOLDS` | *(none)* | Per-methodology overrides, e.g. `{"REDD+": 2.5, "Clean Cookstoves": 4.0}` |
| `SATELLITE_ANOMALY_MIN_SAMPLES` | `5` | Historical observations needed before the z-score means anything |
| `SATELLITE_MAX_TONNES_PER_PERIOD` | `0` | Absolute per-period ceiling; `0` disables |

### 1. Schema validation → **400 rejected**

Required fields, types and ranges. Every problem is reported, not just the
first, so a provider fixing an integration sees the whole list in one round
trip:

```json
{
  "status": "rejected",
  "reason": "schema_validation_failed",
  "errors": [
    { "field": "tonnes_verified", "code": "out_of_range", "message": "'tonnes_verified' must be within 0.0, got -5" },
    { "field": "satellite_cid",   "code": "missing_field", "message": "'satellite_cid' is required" }
  ]
}
```

Error codes are stable identifiers a provider can key handling on:
`missing_field`, `wrong_type`, `out_of_range`, `empty_value`.

Note that `bool` subclasses `int` in Python, so a boolean `methodology_score`
is reported as a type error rather than silently accepted as 0/1.

### 2. Coordinate bounding box → **422 rejected**

The observation must fall inside the project's registered area, within
`SATELLITE_COORD_TOLERANCE_KM`. Three registry shapes are accepted, because
projects were registered under different conventions: an explicit
`{min_lat, max_lat, min_lon, max_lon}` box, a `{lat, lon, radius_km}` point, or
a bare `{lat, lon}` point.

The longitude tolerance is scaled by `cos(latitude)`. Longitude lines converge
toward the poles, so a fixed degrees-per-km conversion silently widens the
tolerance with latitude — at 60°N one km is ~0.018° of longitude, twice the
equatorial figure. Scaling keeps the tolerance an actual distance.

A project with no usable registered coordinates skips this check rather than
being blocked outright.

### 3. Statistical anomaly detection → **202 quarantined**

A sequestration claim more than N standard deviations from the project's own
historical mean (read from `MonitoringData`) is **quarantined for manual
review, not rejected**. A genuine step change — a project expanding its area —
looks identical to fraud from a single sample; that is a human's call, not a
threshold's.

Below `SATELLITE_ANOMALY_MIN_SAMPLES` historical observations the z-score is not
meaningful, so only the absolute ceiling applies. Quarantining every early
submission of a new project would make the queue useless.

The screen runs **before** the consensus engine: an implausible claim must never
enter the quorum pool, or a single fraudulent provider could drag the consensus
value with it.

### Quarantine queue

Entries land in `satellite_quarantine` with the full payload and the statistics
behind the decision. `UNIQUE (project_id, period)` means a provider that keeps
retrying updates its existing entry instead of piling up duplicate reviews.

Reviewed through the backend admin API (all routes require `role=admin`):

| Route | Purpose |
|---|---|
| `GET /admin/satellite/quarantine` | List entries — defaults to `pending`; `?status=approved\|rejected\|all` audits past decisions |
| `GET /admin/satellite/quarantine/depth` | Count awaiting review, for dashboards and alert thresholds |
| `GET /admin/satellite/quarantine/:id` | One entry with its full payload and statistics |
| `POST /admin/satellite/quarantine/:id/review` | Record a decision: `{ "decision": "approved" \| "rejected", "note": "…" }` |

Approving does **not** resubmit the data on chain — it clears the hold so the
provider's next submission for that period is accepted normally. Auto-submitting
from the review endpoint would bypass the IPFS integrity and consensus checks
the payload never reached. Only `pending` entries can be reviewed, so two admins
cannot silently overwrite each other's decision (409 otherwise).
