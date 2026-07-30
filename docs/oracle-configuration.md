# Oracle Configuration

> Reference for all environment variables, circuit breaker tuning, and health endpoint usage
> across the three CarbonLedger oracle services: `verification_listener.py`,
> `price_oracle.py`, and `satellite_monitor.py`.

---

## Table of Contents

1. [Common Variables](#1-common-variables)
2. [Service-Specific Variables](#2-service-specific-variables)
   - [verification_listener.py](#21-verification_listenerpy)
   - [price_oracle.py](#22-price_oraclepy)
   - [satellite_monitor.py](#23-satellite_monitorpy)
3. [Circuit Breaker Configuration](#3-circuit-breaker-configuration)
   - [How the Circuit Breaker Works](#31-how-the-circuit-breaker-works)
   - [State Transitions](#32-state-transitions)
   - [Configuration Variables](#33-configuration-variables)
   - [Alerting](#34-alerting)
4. [Health Endpoints](#4-health-endpoints)
   - [Response Format](#41-response-format)
   - [Integration with Load Balancers](#42-integration-with-load-balancers)
5. [Deployment Notes](#5-deployment-notes)

---

## 1. Common Variables

These variables are read by all three oracle services.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ORACLE_SECRET_KEY` | **yes** | — | Stellar secret key (`S…`) used to sign transactions submitted to Soroban contracts |
| `CARBON_ORACLE_CONTRACT_ID` | **yes** | — | Soroban contract ID of the deployed `carbon_oracle` contract |
| `STELLAR_RPC_URL` | no | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint for all contract calls |
| `NETWORK_PASSPHRASE` | no | Stellar testnet passphrase | Stellar network passphrase for transaction building |
| `ADMIN_ALERT_WEBHOOK` | no | `""` | Webhook URL (Slack, PagerDuty, etc.) to receive circuit-breaker alerts and anomaly notifications |
| `DATABASE_URL` | **yes** | — | PostgreSQL connection string, e.g. `postgresql://user:pass@localhost:5432/carbonledger` |

---

## 2. Service-Specific Variables

### 2.1 `verification_listener.py`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CARBON_REGISTRY_CONTRACT_ID` | **yes** | — | Soroban contract ID of the `carbon_registry` contract |
| `GOLD_STANDARD_API_URL` | no | `""` | Base URL for the Gold Standard monitoring API |
| `GOLD_STANDARD_API_KEY` | no | `""` | Bearer token for the Gold Standard API |
| `VERRA_VCS_API_URL` | no | `""` | Base URL for the Verra VCS monitoring API |
| `VERRA_VCS_API_KEY` | no | `""` | Bearer token for the Verra VCS API |
| `REDIS_URL` | no | `redis://localhost:6379/0` | Redis URL for verification result caching |
| `REDIS_PASSWORD` | no | `""` | Redis AUTH password (if required) |
| `VERIFICATION_CACHE_TTL` | no | `3600` | Redis cache TTL in seconds for verification results |
| `VERIFICATION_CACHE_STALE` | no | `21600` | Age threshold (seconds) at which a cached entry is considered stale and triggers a DB fallback |
| `VERIFICATION_HEALTH_PORT` | no | `5003` | Port for the `/health` HTTP endpoint |

**Polling interval:** Every 6 hours (hardcoded via `schedule.every(6).hours`).

### 2.2 `price_oracle.py`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `XPANSIV_API_KEY` | no | `""` | API key for Xpansiv CBL price feed |
| `TOUCAN_API_KEY` | no | `""` | API key for Toucan Protocol price feed |
| `SDEX_HORIZON_URL` | no | `https://horizon.stellar.org` | Stellar Horizon URL used for SDEX trade aggregation queries |
| `SDEX_VCS_ISSUER` | no | `""` | Stellar account ID of the VCS carbon credit asset issuer on SDEX |
| `SDEX_GS_ISSUER` | no | `""` | Stellar account ID of the Gold Standard asset issuer on SDEX |
| `SDEX_ACM_ISSUER` | no | `""` | Stellar account ID of the ACM asset issuer on SDEX |
| `SDEX_CAR_ISSUER` | no | `""` | Stellar account ID of the CAR asset issuer on SDEX |
| `SDEX_REDD_ISSUER` | no | `""` | Stellar account ID of the REDD+ asset issuer on SDEX |
| `USDC_ISSUER` | no | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | USDC asset issuer on Stellar |
| `BACKEND_API_URL` | no | `http://localhost:3001/api/v1` | Base URL of the NestJS backend (used for price approval workflow) |
| `BACKEND_JWT_TOKEN` | no | `""` | JWT token for authenticated calls to the backend price approval endpoints |
| `PRICE_ORACLE_HEALTH_PORT` | no | `5002` | Port for the `/health` HTTP endpoint |

**Update interval:** Every 12 hours (hardcoded via `schedule.every(12).hours`).  
**Approval poll interval:** Every 5 minutes.

### 2.3 `satellite_monitor.py`

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GEE_WEBHOOK_SECRET` | no | `""` | Legacy plaintext secret for the `X-GEE-Secret` backward-compat path. Leave empty to disable legacy auth. |
| `BACKEND_API_URL` | no | `http://localhost:3001` | Backend base URL used to fetch project coordinates for coordinate validation |
| `SATELLITE_MONITOR_PORT` | no | `5001` | Port for the Flask webhook server and `/health` endpoint |

> For HMAC-SHA256 authentication, provider keys are stored in the `SatelliteWebhookProvider`
> PostgreSQL table. See [docs/satellite-webhook-auth.md](satellite-webhook-auth.md) for the
> complete authentication guide.

---

## 3. Circuit Breaker Configuration

### 3.1 How the Circuit Breaker Works

All three oracle services wrap every call to the Soroban RPC endpoint in a
**circuit breaker** (`oracle/circuit_breaker.py`).  The circuit breaker tracks
consecutive RPC failures and, when the failure threshold is reached, **opens**
the circuit — all subsequent calls are rejected immediately without attempting
a new RPC request.  After a configurable cooldown, the circuit enters a
**half-open** probe state, allowing a single test call through.  If the probe
succeeds, the circuit closes and normal operation resumes; if it fails, the
circuit re-opens and the cooldown restarts.

### 3.2 State Transitions

```
                 ┌─────────────────────────────────────────────┐
                 │                                             │
        failure_count >= threshold                  probe fails
                 │                                             │
                 ▼                                             │
  ┌──────────┐  trip   ┌──────────┐  cooldown  ┌───────────┐  │
  │  CLOSED  │ ──────► │   OPEN   │ ──────────►│ HALF_OPEN │──┘
  │(normal)  │         │(rejected)│  elapsed   │ (1 probe) │
  └──────────┘         └──────────┘            └───────────┘
       ▲                                             │
       │                                    probe succeeds
       └─────────────────────────────────────────────┘
       success_count >= success_threshold
```

| State | Behaviour |
|-------|-----------|
| **CLOSED** | All calls pass through; failure counter increments on errors; resets on success |
| **OPEN** | All calls rejected immediately with `CircuitOpenError`; no RPC is attempted |
| **HALF_OPEN** | One probe call allowed; success → CLOSED; failure → OPEN (cooldown restarts) |

### 3.3 Configuration Variables

These variables are read by `circuit_breaker.py` at module import time and apply
to **all circuits** in the process (one per oracle service, named by service).

| Variable | Default | Description |
|----------|---------|-------------|
| `CB_FAILURE_THRESHOLD` | `5` | Number of consecutive failures before the circuit opens |
| `CB_COOLDOWN_SECONDS` | `60` | Seconds to wait in OPEN state before allowing a single probe |
| `CB_SUCCESS_THRESHOLD` | `2` | Consecutive successes in HALF_OPEN required before circuit closes |

**Tuning guidance:**

- **Low-latency environments** (sub-second RPC): keep defaults.  A 5-failure threshold
  with a 60-second cooldown means the circuit opens after ~5 s of failures and probes
  after 1 minute.
- **High-latency environments** (slow RPC, long timeouts): increase `CB_COOLDOWN_SECONDS`
  to 300–600 s to avoid rapid probe-fail cycles.
- **Critical/high-throughput paths**: lower `CB_FAILURE_THRESHOLD` to 3 to trip faster
  and reduce cascading failures.
- **Sensitive to blips**: raise `CB_FAILURE_THRESHOLD` to 10 to tolerate transient errors
  without tripping.

**Example `.env` snippet:**

```dotenv
CB_FAILURE_THRESHOLD=5
CB_COOLDOWN_SECONDS=120
CB_SUCCESS_THRESHOLD=2
ADMIN_ALERT_WEBHOOK=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

### 3.4 Alerting

When a circuit transitions from **CLOSED → OPEN**, an HTTP POST is sent to
`ADMIN_ALERT_WEBHOOK` (if configured) with the following JSON payload:

```json
{
  "circuit":  "verification_listener_rpc",
  "state":    "open",
  "message":  "Circuit 'verification_listener_rpc' opened after 5 consecutive failures. RPC calls will be rejected until the cooldown (60s) elapses."
}
```

If `ADMIN_ALERT_WEBHOOK` is not set, the alert is printed to stderr.

**Circuit names** (one per oracle service):

| Service | Circuit Name |
|---------|--------------|
| `verification_listener.py` | `verification_listener_rpc` |
| `price_oracle.py` | `price_oracle_rpc` |
| `satellite_monitor.py` | `satellite_monitor_rpc` |

---

## 4. Health Endpoints

Each oracle service exposes a `/health` HTTP endpoint that returns the current
circuit-breaker state for all registered circuits in the process.

| Service | Default Port | Environment Variable |
|---------|-------------|---------------------|
| `satellite_monitor.py` | `5001` | `SATELLITE_MONITOR_PORT` |
| `price_oracle.py` | `5002` | `PRICE_ORACLE_HEALTH_PORT` |
| `verification_listener.py` | `5003` | `VERIFICATION_HEALTH_PORT` |

### 4.1 Response Format

```
GET /health
```

**Response (200 OK):**

```json
{
  "status": "ok",
  "circuits": {
    "verification_listener_rpc": {
      "state":           "closed",
      "failure_count":   0,
      "last_failure_at": null,
      "last_opened_at":  null
    },
    "price_oracle_rpc": {
      "state":           "open",
      "failure_count":   5,
      "last_failure_at": "2026-07-27T14:23:11+00:00",
      "last_opened_at":  "2026-07-27T14:23:11+00:00"
    }
  }
}
```

**Field definitions:**

| Field | Type | Description |
|-------|------|-------------|
| `state` | string | `"closed"` \| `"open"` \| `"half_open"` |
| `failure_count` | integer | Consecutive failures since last successful call |
| `last_failure_at` | string \| null | ISO-8601 UTC timestamp of the most recent failure |
| `last_opened_at` | string \| null | ISO-8601 UTC timestamp when the circuit last opened |

### 4.2 Integration with Load Balancers

The `/health` endpoint returns HTTP `200` in all states (including when a circuit
is open).  This is intentional — the oracle services are stateful schedulers, not
stateless HTTP servers, and removing them from a load balancer when a circuit is
open would hide the problem.

**Recommended monitoring approach:**

1. Poll `/health` every 30 seconds from your monitoring system (Grafana, Datadog, etc.).
2. Alert if `circuits.<name>.state != "closed"` for more than 2 consecutive polls.
3. Alert if any service stops responding to `/health` (liveness failure).

**Example Prometheus scrape config** (if you expose `/health` as a metrics endpoint):

```yaml
- job_name: 'oracle_health'
  scrape_interval: 30s
  metrics_path: '/health'
  static_configs:
    - targets:
        - 'oracle:5001'   # satellite_monitor
        - 'oracle:5002'   # price_oracle
        - 'oracle:5003'   # verification_listener
```

---

## 5. Deployment Notes

- All three oracle services can run in the same Docker container (they use separate
  Flask instances on different ports) or as separate containers.  The `docker-compose.yml`
  starts them as a single `oracle` service.
- Circuit breaker state is **in-process and non-persistent**.  A service restart resets
  all circuits to CLOSED.  This is intentional — if a restart was triggered because
  RPC recovered, the circuit should start fresh.
- The `CB_*` variables apply globally across all circuits in a process.  If you need
  per-circuit tuning (e.g., a longer cooldown for price updates vs. monitoring),
  instantiate `CircuitBreaker` directly in your code:

  ```python
  from circuit_breaker import CircuitBreaker
  my_circuit = CircuitBreaker("my_service", failure_threshold=3, cooldown_seconds=300)
  ```

- In production, ensure `STELLAR_RPC_URL` points to a reliable, low-latency RPC
  provider.  Multiple RPC failover is out of scope for the circuit breaker but can
  be layered on top: catch `CircuitOpenError` and retry with a secondary RPC URL.
