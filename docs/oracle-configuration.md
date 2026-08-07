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

## Submission Retry and Dead-Letter Queue (Verification Listener)

The verification listener submits monitoring data on chain through
[`IdempotentRetrySubmitter`](../oracle/retry_submitter.py). Transient RPC
failures are retried with exponential backoff; duplicates never reach the
blockchain; anything undeliverable lands in a durable dead-letter table.

### Configuration

| Variable | Default | Description |
|---|---|---|
| `SUBMISSION_MAX_RETRIES` | `8` | Attempts before a payload is dead-lettered |
| `SUBMISSION_BACKOFF_BASE` | `2` | Exponential base — delay for attempt *n* is `BASE_DELAY * BASE^n` |
| `SUBMISSION_BASE_DELAY` | `1.0` | First-retry delay in seconds |
| `SUBMISSION_MAX_DELAY` | `60` | Ceiling on any single sleep |
| `SUBMISSION_JITTER_RATIO` | `0.5` | Delay is drawn from `[(1-ratio)·d, d]` |
| `DLQ_ALERT_THRESHOLD` | `10` | Alert once this many unresolved dead letters accumulate |
| `DLQ_ALERT_WEBHOOK` | `ADMIN_ALERT_WEBHOOK` | Where depth alerts are POSTed |

With the defaults, the retry schedule is roughly 1s, 2s, 4s, 8s, 16s, 32s, 60s
(capped) — about two minutes of RPC outage absorbed before dead-lettering, each
delay jittered down by up to 50%.

Jitter matters more than the exponent here: without it, N listener replicas that
fail on the same RPC outage retry in lockstep and re-create the thundering herd
that knocked the endpoint over.

### Exactly-once guarantees

Two independent layers, because either alone is insufficient:

**Off-chain — duplicate rejection.** The submission id is content-addressed:
`sha256(canonical_json(payload))`. Claiming it is an atomic
`INSERT … ON CONFLICT DO NOTHING` against `oracle_submission_nonces`, so a
replay after a crash conflicts on insert and is rejected *before* any RPC call.
A submission already marked `submitted` returns its recorded transaction hash
instead of resubmitting.

**On-chain — nonce reuse.** Each submission id is allocated exactly one nonce,
reused across every retry. If attempt 3 actually landed on chain but its
response was lost, attempt 4 replays the *same* nonce and the contract rejects
it with `InvalidNonce` rather than recording the data twice. This is what covers
the ambiguous-failure case the off-chain check cannot see.

### Transient vs permanent failures

A submit function raises `PermanentSubmissionError` for failures retrying cannot
fix — malformed payloads, contract-level rejections, authorisation errors. Those
go straight to the dead-letter table instead of consuming the full retry budget.
Every other exception is treated as transient and retried.

### Dead-letter table

`oracle_dead_letters` stores the payload, every error seen across all attempts,
the attempt count, the allocated nonce and first/last failure timestamps. Unlike
the Redis DLQ used by the price oracle, these survive a Redis flush — which is
what an operator needs to decide whether a batch is safe to replay.

```bash
python3 oracle/dead_letter_cli.py list                    # what is stuck, and why
python3 oracle/dead_letter_cli.py depth --alert           # exits 1 when over threshold
python3 oracle/dead_letter_cli.py resolve <id> --note "…" # mark handled
```

Replay is deliberately not a CLI command: a dead letter still holds its
allocated nonce, so a replay must go back through `IdempotentRetrySubmitter`
inside the listener. Reissuing it from a CLI would bypass the idempotency claim
that makes exactly-once work.
