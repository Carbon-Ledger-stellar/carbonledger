# Oracle Integration Guide

This document describes how the three Python oracle services authenticate with and submit data to the `carbon_oracle` Soroban contract on Stellar.

---

## Architecture Overview

Three independent services bridge off-chain data to on-chain state:

| Service | File | Trigger | Contract function(s) |
|---------|------|---------|---------------------|
| Verification Listener | `verification_listener.py` | Scheduled every 6 hours | `submit_monitoring_data` |
| Price Oracle | `price_oracle.py` | Scheduled every 12 hours | `update_credit_price` |
| Satellite Monitor | `satellite_monitor.py` | Webhook (POST `/webhook/satellite`) | `submit_monitoring_data`, `flag_project` |

All three services share the same oracle Stellar keypair (`ORACLE_SECRET_KEY`) and target the same `CARBON_ORACLE_CONTRACT_ID`. They run as independent processes and can be started simultaneously.

---

## Authentication

### Contract calls

Every contract invocation is signed with the oracle's Ed25519 Stellar keypair:

```python
keypair = Keypair.from_secret(os.environ["ORACLE_SECRET_KEY"])
tx.sign(keypair)
```

The oracle contract stores the authorised oracle address in persistent storage during `initialize()`. Any call whose signer does not match this address is rejected with `CarbonError::UnauthorizedOracle (8)`.

The oracle public key (`keypair.public_key`) is also passed as the first `scval.to_address(...)` argument to every contract function, satisfying Soroban's `require_auth()` check.

### External API authentication

| Service | API | Header |
|---------|-----|--------|
| Verification Listener | Gold Standard | `Authorization: Bearer <GOLD_STANDARD_API_KEY>` |
| Verification Listener | Verra VCS | `Authorization: Bearer <VERRA_VCS_API_KEY>` |
| Price Oracle | Xpansiv CBL | `X-API-Key: <XPANSIV_API_KEY>` |
| Price Oracle | Toucan Protocol | `Authorization: Bearer <TOUCAN_API_KEY>` |
| Satellite Monitor | Incoming webhooks | `X-GEE-Secret: <GEE_WEBHOOK_SECRET>` (validated on receipt) |

Missing API keys cause the affected feed to be skipped with a warning log. The service continues with any remaining feeds.

---

## Service 1 — Verification Listener

### Flow

```
verification_listener.py — runs every 6 hours
─────────────────────────────────────────────────────────────────────────
for each verifier API (Gold Standard, Verra VCS):
  GET {api_url}/monitoring-reports/pending
    → {"reports": [{project_id, period, tonnes_verified, satellite_cid,
                    verifier_signature, methodology, ...}]}

  for each report:
    validate_methodology_report(report, methodology)
      → (is_valid: bool, score: 0-100)
      Scoring: start at 100
        -20 per missing required field (project_id, period, tonnes_verified,
              satellite_cid, verifier_signature)
        -30 if tonnes_verified <= 0
        -15 if satellite_cid does not start with "Qm" (not an IPFS CID)
        -10 if additionality_proof missing (VCS / Gold Standard only)
        -5  if permanence_buffer missing (VCS / Gold Standard only)
        floor at 0

    if score < 70:
      log warning + POST to ADMIN_ALERT_WEBHOOK

    if not is_valid (score < 70):
      log_oracle_update(..., status="SKIPPED_INVALID")
      continue

    build_and_submit(submit_monitoring_data, [...args...])
      → tx_hash (or raises on failure)

    log_oracle_update(..., status="SUBMITTED")
─────────────────────────────────────────────────────────────────────────
```

### Contract call

```
Function:  submit_monitoring_data
Arguments:
  oracle_signer    Address    keypair.public_key
  project_id       String     "PROJECT-001"
  period           String     "2024-Q1"
  tonnes_verified  i128       5000
  methodology_score u32       85
  satellite_cid    String     "QmXyZ..."
```

### Example payload (Gold Standard API response → contract args)

External API response:
```json
{
  "reports": [
    {
      "project_id": "GS-2847",
      "period": "2024-Q1",
      "tonnes_verified": 5000,
      "satellite_cid": "QmXyZabc123...",
      "verifier_signature": "0xdeadbeef...",
      "methodology": "Gold Standard",
      "additionality_proof": "ipfs://Qmadd...",
      "permanence_buffer": "15%"
    }
  ]
}
```

Resulting Soroban invocation:
```python
[
    scval.to_address("GBORACLE..."),   # oracle public key
    scval.to_string("GS-2847"),        # project_id
    scval.to_string("2024-Q1"),        # period
    scval.to_int128(5000),             # tonnes_verified
    scval.to_uint32(90),               # methodology_score
    scval.to_string("QmXyZabc123..."), # satellite_cid
]
```

### Database logging

Every processed report is written to `oracle_updates`:

```sql
INSERT INTO oracle_updates
  (project_id, period, tonnes_verified, methodology_score, tx_hash, status, submitted_at)
VALUES ($1, $2, $3, $4, $5, $6, NOW())
```

`status` values: `SUBMITTED`, `SKIPPED_INVALID`, `ERROR: <message>`

---

## Service 2 — Price Oracle

### Flow

```
price_oracle.py — runs every 12 hours
─────────────────────────────────────────────────────────────────────────
fetch_xpansiv_prices()  → list of {methodology, vintage_year, price_usd, volume}
fetch_toucan_prices()   → list of {methodology, vintage_year, price_usd, volume}

aggregate_prices(xpansiv, toucan)
  → volume-weighted average per (methodology, vintage_year)
  → {("VCS", 2022): 14.50, ("Gold Standard", 2023): 18.20, ...}

for each (methodology, vintage_year), price_usd:
  stroops = int(price_usd * 10_000_000)

  if (methodology, vintage_year) in _last_prices:
    deviation = |stroops - last| / last
    if deviation > 0.15:
      POST to ADMIN_ALERT_WEBHOOK

  build_and_submit(update_credit_price, [...args...])
    → tx_hash (or logs error and continues)

  _last_prices[(methodology, vintage_year)] = stroops
─────────────────────────────────────────────────────────────────────────
```

### Price storage on-chain

Prices are stored in **temporary** Soroban storage with a 24-hour TTL (17,280 ledgers). The in-memory `_last_prices` dict survives the 12-hour schedule interval and is used for deviation detection across cycles. It is reset when the process restarts.

### Contract call

```
Function:  update_credit_price
Arguments:
  oracle_signer  Address    keypair.public_key
  methodology    String     "VCS"
  vintage_year   u32        2022
  price_usdc     i128       145000000   (14.50 USD × 10^7 stroops)
```

### Example payload

Aggregated result from both feeds:
```python
prices = {("VCS", 2022): 14.50, ("Gold Standard", 2023): 18.20}
```

Soroban invocation for `("VCS", 2022)`:
```python
[
    scval.to_address("GBORACLE..."),  # oracle public key
    scval.to_string("VCS"),           # methodology
    scval.to_uint32(2022),            # vintage_year
    scval.to_int128(145_000_000),     # 14.50 USD in stroops
]
```

### Price deviation alert

When a single update moves a price more than 15% from the last submitted value, the admin webhook receives:

```
⚠️ Price deviation alert: VCS 2022 moved 18.3% ($17.15 USD)
```

The submission still proceeds — the alert is informational only.

---

## Service 3 — Satellite Monitor

### Flow

```
satellite_monitor.py — Flask webhook server on port 5001 (default)
─────────────────────────────────────────────────────────────────────────
POST /webhook/satellite
  Headers:
    X-GEE-Secret: <GEE_WEBHOOK_SECRET>   (required if env var is set)
    Content-Type: application/json

  1. Validate X-GEE-Secret header → 401 if mismatch
  2. Parse JSON body → 400 if missing required fields
     (project_id, period, satellite_cid)

  3. GET {BACKEND_API_URL}/projects/{project_id}
       → fetch registered coordinates {lat, lon}

  4. coordinates_match(registered, satellite, tolerance_km=1.0)?
       threshold = 1.0 * 0.009 degrees (~1 km at equator)
       if mismatch → alert_admin → return 422 "coordinate_mismatch"

  5. detect_contradiction(data)?
       condition: project_type in ("forestry", "blue_carbon")
                  AND deforestation_pct > 5.0
                  AND reported_tonnes_sequestered > 0
       if true:
         build_and_submit(flag_project, [...])
         alert_admin
         return 200 {"status": "flagged"}

  6. build_and_submit(submit_monitoring_data, [...])
     return 200 {"status": "submitted", "tx_hash": "..."}
─────────────────────────────────────────────────────────────────────────
```

### Incoming webhook payload

```json
{
  "project_id": "REDD-442",
  "period": "2024-H1",
  "satellite_cid": "QmSatelliteImageCID...",
  "tonnes_verified": 3200,
  "methodology_score": 88,
  "deforestation_pct": 1.2,
  "reported_tonnes_sequestered": 3200.0,
  "project_type": "forestry",
  "coordinates": { "lat": -3.4653, "lon": -62.2159 }
}
```

Header:
```
X-GEE-Secret: your-webhook-secret
```

### Contract calls

**On valid data:**
```
Function:  submit_monitoring_data
Arguments:
  scval.to_address(keypair.public_key)      # oracle_signer
  scval.to_string("REDD-442")               # project_id
  scval.to_string("2024-H1")                # period
  scval.to_int128(3200)                     # tonnes_verified
  scval.to_uint32(88)                       # methodology_score
  scval.to_string("QmSatelliteImageCID...") # satellite_cid
```

**On contradiction detected:**
```
Function:  flag_project
Arguments:
  scval.to_address(keypair.public_key)                 # oracle_signer
  scval.to_string("REDD-442")                          # project_id
  scval.to_string("satellite_contradiction_detected")  # reason
```

### HTTP responses

| Condition | Status | Body |
|-----------|--------|------|
| Valid, submitted | 200 | `{"status": "submitted", "tx_hash": "abc..."}` |
| Contradiction, flagged | 200 | `{"status": "flagged", "reason": "satellite_contradiction"}` |
| Coordinate mismatch | 422 | `{"status": "rejected", "reason": "coordinate_mismatch"}` |
| Missing fields | 400 | `{"error": "Missing required fields"}` |
| Invalid webhook secret | 401 | `{"error": "Unauthorized"}` |
| Contract submit failed | 500 | `{"status": "error", "message": "..."}` |

### Health check

```
GET /health → 200 {"status": "ok"}
```

---

## Shared Transaction Submission Pattern

All three services use an identical `build_and_submit` pattern:

```python
# 1. Build transaction
tx = TransactionBuilder(source_account, network_passphrase, base_fee=300)
      .append_invoke_contract_function_op(contract_id, function_name, args)
      .set_timeout(30)
      .build()

# 2. Simulate + prepare
tx = server.prepare_transaction(tx)

# 3. Sign with oracle keypair
tx.sign(keypair)

# 4. Submit
response = server.send_transaction(tx)

# 5. Poll for confirmation (max 60 seconds)
for _ in range(20):           # 20 attempts
    time.sleep(3)             # 3 seconds each
    result = server.get_transaction(response.hash)
    if result.status == "SUCCESS":
        return response.hash
    if result.status == "FAILED":
        raise RuntimeError(...)

raise TimeoutError(...)       # raised after 60 s
```

---

## Retry Behaviour and Failure Modes

| Failure | Behaviour |
|---------|-----------|
| Transaction `ERROR` on send | Raises `RuntimeError` immediately, no retry |
| Transaction `FAILED` on poll | Raises `RuntimeError` immediately, no retry |
| Transaction not confirmed in 60 s | Raises `TimeoutError`, no automatic retry |
| External API unreachable or HTTP error | Logs error, returns empty list, continues with other feeds |
| Missing API key | Logs warning, skips that feed entirely |
| Methodology score < 70 | Logs warning, alerts admin, skips contract submission |
| Coordinate mismatch (satellite) | Returns 422, alerts admin, no contract call |
| Contradiction detected | Calls `flag_project` on-chain, alerts admin, returns 200 |
| Admin webhook unreachable | Logs warning, continues — alerts are best-effort |
| DB write failure (`log_oracle_update`) | Logs error, does not affect contract submission |

The services do not implement automatic retry of failed Soroban transactions. Transient failures are expected to be resolved on the next scheduled run (6 h or 12 h). For the satellite webhook, callers (GEE) are expected to retry on 5xx responses.

---

## Environment Variables

All services read from a shared `.env` file (via `python-dotenv`):

```env
# Required by all three services
ORACLE_SECRET_KEY=S...              # Ed25519 secret key for contract signing
CARBON_ORACLE_CONTRACT_ID=C...      # Deployed carbon_oracle contract address
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Required by verification_listener.py
CARBON_REGISTRY_CONTRACT_ID=C...
DATABASE_URL=postgresql://user:pass@localhost:5432/carbonledger
GOLD_STANDARD_API_URL=https://api.goldstandard.org
GOLD_STANDARD_API_KEY=...
VERRA_VCS_API_URL=https://api.verra.org
VERRA_VCS_API_KEY=...

# Required by price_oracle.py
XPANSIV_API_KEY=...
TOUCAN_API_KEY=...

# Required by satellite_monitor.py
BACKEND_API_URL=http://localhost:3001
GEE_WEBHOOK_SECRET=...              # Optional; if set, all webhooks must include it
SATELLITE_MONITOR_PORT=5001         # Optional; defaults to 5001

# Shared optional
ADMIN_ALERT_WEBHOOK=https://hooks.slack.com/...  # Slack/Discord webhook URL
```

---

## Running the Services

```bash
cd oracle
pip install -r requirements.txt

# Run each in a separate terminal (or via Docker Compose)
python3 verification_listener.py   # polls every 6 hours
python3 price_oracle.py            # polls every 12 hours
python3 satellite_monitor.py       # webhook server on port 5001
```

All three can also be started via Docker Compose:

```bash
docker-compose up oracle_verification oracle_price oracle_satellite
```
