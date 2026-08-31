# Oracle Service Setup and Configuration Guide

The oracle layer bridges off-chain data sources (verifier APIs, satellite imagery, price feeds) with the on-chain `carbon_oracle` Soroban contract. It consists of three independent Python services.

---

## Table of Contents

- [Services Overview](#services-overview)
- [Prerequisites](#prerequisites)
- [Credentials and Where to Obtain Them](#credentials-and-where-to-obtain-them)
- [Environment Variables](#environment-variables)
- [Running in Development with Mock Data](#running-in-development-with-mock-data)
- [Running in Production](#running-in-production)
- [Service Reference](#service-reference)
  - [verification_listener](#verification_listener)
  - [price_oracle](#price_oracle)
  - [satellite_monitor](#satellite_monitor)
- [Webhook Configuration](#webhook-configuration)
- [Expected Log Output](#expected-log-output)

---

## Services Overview

| Service | File | Trigger | What it does |
|---|---|---|---|
| `verification_listener` | `verification_listener.py` | Polls every 6 hours | Fetches monitoring reports from Gold Standard / Verra VCS APIs, validates them, and submits verified data to `carbon_oracle` |
| `price_oracle` | `price_oracle.py` | Polls every 12 hours | Fetches carbon credit benchmark prices from Xpansiv CBL and Toucan Protocol, aggregates them, and pushes to `carbon_oracle` |
| `satellite_monitor` | `satellite_monitor.py` | HTTP webhook (Flask) | Receives satellite data from Google Earth Engine, validates coordinates, detects contradictions, and submits evidence CIDs on-chain |

---

## Prerequisites

- Python 3.10+
- A funded Stellar testnet keypair for the oracle (the `ORACLE_SECRET_KEY`)
- The `carbon_oracle` contract deployed and its contract ID available
- PostgreSQL running (required by `verification_listener` for audit logging)

Install dependencies:

```bash
cd oracle
pip install -r requirements.txt
```

---

## Credentials and Where to Obtain Them

### Stellar Oracle Keypair (`ORACLE_SECRET_KEY`)

The oracle signs every on-chain transaction. Generate a dedicated keypair — do not reuse the admin key.

```bash
# Generate a new keypair with the Stellar CLI
stellar keys generate oracle-key --network testnet

# Fund it on testnet
stellar keys fund oracle-key --network testnet

# Show the secret key
stellar keys show oracle-key
```

Copy the secret key (`S...`) into `ORACLE_SECRET_KEY` and the public key (`G...`) into `ORACLE_PUBLIC_KEY` in your `.env`.

The oracle public key must be registered as an authorized oracle in the `carbon_oracle` contract (done during contract initialization by the admin).

---

### Google Earth Engine (`GOOGLE_EARTH_ENGINE_KEY`, `GEE_WEBHOOK_SECRET`)

GEE pushes satellite monitoring data to the `satellite_monitor` webhook.

1. Sign up at [earthengine.google.com](https://earthengine.google.com) and request API access (approval takes 1–3 days for research/commercial accounts).
2. In the [Google Cloud Console](https://console.cloud.google.com), create a service account and download its JSON key file. Set `GOOGLE_EARTH_ENGINE_KEY` to the path of that file, or paste the JSON content as a single-line string.
3. Choose a random secret string for `GEE_WEBHOOK_SECRET` (e.g. `openssl rand -hex 32`). Configure GEE to send this value in the `X-GEE-Secret` header on every webhook call.

> **Development:** You do not need a real GEE account to run locally. See [Running in Development with Mock Data](#running-in-development-with-mock-data).

---

### Xpansiv CBL (`XPANSIV_API_KEY`)

Xpansiv CBL is the primary carbon credit benchmark price source.

1. Register at [xpansiv.com](https://xpansiv.com) and request API access through their market data team.
2. Once approved, your API key is available in the Xpansiv developer portal.
3. Set `XPANSIV_API_KEY` in your `.env`.

> **Development:** Leave `XPANSIV_API_KEY` empty. The service logs a warning and skips the Xpansiv feed, falling back to Toucan or mock data.

---

### Toucan Protocol (`TOUCAN_API_KEY`)

Secondary price feed used for weighted average aggregation.

1. Register at [toucan.earth](https://toucan.earth) and request API access.
2. Set `TOUCAN_API_KEY` in your `.env`.

> **Development:** Leave `TOUCAN_API_KEY` empty. The service logs a warning and skips the Toucan feed.

---

### Gold Standard and Verra VCS APIs (`GOLD_STANDARD_API_KEY`, `VERRA_VCS_API_KEY`)

Used by `verification_listener` to fetch pending monitoring reports.

- **Gold Standard:** Request API access at [goldstandard.org](https://goldstandard.org/contact). Set `GOLD_STANDARD_API_URL` and `GOLD_STANDARD_API_KEY`.
- **Verra VCS:** Request API access at [verra.org](https://verra.org). Set `VERRA_VCS_API_URL` and `VERRA_VCS_API_KEY`.

> **Development:** Leave both URL variables empty. The service skips those feeds and processes zero reports (safe no-op).

---

### Admin Alert Webhook (`ADMIN_ALERT_WEBHOOK`)

Optional. All three services post alert messages here when anomalies are detected (low methodology scores, price deviations, satellite contradictions). Any webhook that accepts a JSON `POST` with a `text` field works — Slack incoming webhooks are the most common choice.

Leave empty in development; alerts will be logged to stdout instead.

---

## Environment Variables

All variables are read from the `.env` file in the project root (loaded via `python-dotenv`). Copy `.env.example` to `.env` and fill in the values below.

| Variable | Required | Default | Description |
|---|---|---|---|
| `ORACLE_SECRET_KEY` | **Yes** | — | Stellar secret key (`S...`) used to sign oracle transactions |
| `CARBON_ORACLE_CONTRACT_ID` | **Yes** | — | Deployed `carbon_oracle` contract address |
| `CARBON_REGISTRY_CONTRACT_ID` | **Yes** | — | Deployed `carbon_registry` contract address |
| `STELLAR_RPC_URL` | No | `https://soroban-testnet.stellar.org` | Soroban RPC endpoint |
| `NETWORK_PASSPHRASE` | No | Testnet passphrase | Stellar network passphrase |
| `DATABASE_URL` | **Yes** (verification_listener) | — | PostgreSQL connection string for oracle audit log |
| `GOLD_STANDARD_API_URL` | No | `""` | Gold Standard API base URL |
| `GOLD_STANDARD_API_KEY` | No | `""` | Gold Standard API key |
| `VERRA_VCS_API_URL` | No | `""` | Verra VCS API base URL |
| `VERRA_VCS_API_KEY` | No | `""` | Verra VCS API key |
| `XPANSIV_API_KEY` | No | `""` | Xpansiv CBL API key |
| `TOUCAN_API_KEY` | No | `""` | Toucan Protocol API key |
| `GEE_WEBHOOK_SECRET` | No | `""` | Shared secret validated on every satellite webhook call |
| `GOOGLE_EARTH_ENGINE_KEY` | No | `""` | GEE service account key (path or JSON string) |
| `ADMIN_ALERT_WEBHOOK` | No | `""` | Webhook URL for admin alerts (Slack, etc.) |
| `BACKEND_API_URL` | No | `http://localhost:3001/api/v1` | Backend API base URL |
| `BACKEND_JWT_TOKEN` | No | `""` | JWT for authenticated backend calls (price approvals) |
| `SATELLITE_MONITOR_PORT` | No | `5001` | Port for the satellite_monitor Flask server |
| `LOG_LEVEL` | No | `INFO` | Log verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

---

## Running in Development with Mock Data

In development you do not need real API keys. The services degrade gracefully when credentials are absent, and you can inject mock data directly.

### Minimal `.env` for local development

```dotenv
# Stellar — use testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE="Test SDF Network ; September 2015"

# Fill these in after contract deployment
CARBON_ORACLE_CONTRACT_ID=C...
CARBON_REGISTRY_CONTRACT_ID=C...

# Generate with: stellar keys generate oracle-key --network testnet
ORACLE_SECRET_KEY=S...

# Local PostgreSQL
DATABASE_URL=postgresql://carbonledger:password@localhost:5432/carbonledger

# Leave all API keys empty — services will skip those feeds
GOLD_STANDARD_API_URL=
GOLD_STANDARD_API_KEY=
VERRA_VCS_API_URL=
VERRA_VCS_API_KEY=
XPANSIV_API_KEY=
TOUCAN_API_KEY=
GEE_WEBHOOK_SECRET=dev-secret
```

### Sending a mock satellite webhook

With `satellite_monitor` running locally, send a test payload:

```bash
curl -X POST http://localhost:5001/webhook/satellite \
  -H "Content-Type: application/json" \
  -H "X-GEE-Secret: dev-secret" \
  -d '{
    "project_id": "PROJ-001",
    "period": "2024-Q1",
    "satellite_cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    "tonnes_verified": 500,
    "methodology_score": 85,
    "coordinates": {"lat": -3.4653, "lon": -62.2159},
    "project_type": "forestry",
    "deforestation_pct": 0.5,
    "reported_tonnes_sequestered": 500
  }'
```

Expected response:

```json
{"status": "submitted", "tx_hash": "abc123..."}
```

### Triggering a mock contradiction (flagging flow)

```bash
curl -X POST http://localhost:5001/webhook/satellite \
  -H "Content-Type: application/json" \
  -H "X-GEE-Secret: dev-secret" \
  -d '{
    "project_id": "PROJ-001",
    "period": "2024-Q2",
    "satellite_cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    "tonnes_verified": 0,
    "methodology_score": 40,
    "coordinates": {"lat": -3.4653, "lon": -62.2159},
    "project_type": "forestry",
    "deforestation_pct": 25.0,
    "reported_tonnes_sequestered": 1000
  }'
```

Expected response:

```json
{"status": "flagged", "reason": "satellite_contradiction"}
```

---

## Running in Production

Each service runs as a standalone process. Use a process manager (systemd, Docker, or supervisord) to keep them alive.

```bash
cd oracle

# Terminal 1 — verification listener (polls every 6 hours)
python3 verification_listener.py

# Terminal 2 — price oracle (polls every 12 hours)
python3 price_oracle.py

# Terminal 3 — satellite monitor webhook server
python3 satellite_monitor.py
```

With Docker Compose, all three start automatically:

```bash
docker-compose up oracle
```

---

## Service Reference

### `verification_listener`

**What it does:** Polls the Gold Standard and Verra VCS APIs every 6 hours for pending monitoring reports. Each report is validated against methodology requirements (required fields, positive tonnes, IPFS satellite CID, additionality proof). Reports scoring ≥ 70/100 are submitted to the `carbon_oracle` contract via `submit_monitoring_data`. Every submission is logged to the `oracle_updates` PostgreSQL table.

**Schedule:** Runs immediately on start, then every 6 hours.

**Methodology score breakdown:**

| Check | Points deducted if failing |
|---|---|
| Missing required field (×5 fields) | −20 per field |
| Non-positive `tonnes_verified` | −30 |
| `satellite_cid` not a valid IPFS CID | −15 |
| Missing `additionality_proof` (VCS/Gold Standard) | −10 |
| Missing `permanence_buffer` (VCS/Gold Standard) | −5 |

Reports scoring below 70 are skipped and logged as `SKIPPED_INVALID`. An admin alert is sent for scores between 70 and 85.

---

### `price_oracle`

**What it does:** Fetches benchmark prices from Xpansiv CBL and Toucan Protocol every 12 hours, calculates a volume-weighted average per `(methodology, vintage_year)` pair, and pushes prices to the `carbon_oracle` contract via `update_credit_price`. Prices are stored in stroops (1 USDC = 10,000,000 stroops).

**Deviation guard:** If a new price deviates more than 15% from the last submitted price, the update is held and sent to the backend for admin approval instead of being pushed on-chain immediately. A separate poller checks for approved prices every 5 minutes and submits them.

**Schedule:** Price fetch runs immediately on start, then every 12 hours. Approval poller runs immediately on start, then every 5 minutes.

---

### `satellite_monitor`

**What it does:** Flask HTTP server that receives satellite monitoring data from Google Earth Engine via webhook. On each request it:

1. Validates the `X-GEE-Secret` header.
2. Looks up the project's registered coordinates from the backend API.
3. Checks that the satellite observation coordinates match the registered project area (within 1 km tolerance).
4. Detects contradictions: if a forestry or blue carbon project reports deforestation > 5% while claiming positive sequestration, the project is flagged on-chain via `flag_project`.
5. For valid data, submits the satellite CID and monitoring data on-chain via `submit_monitoring_data`.

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhook/satellite` | Receive satellite monitoring data |
| `GET` | `/health` | Health check — returns `{"status": "ok"}` |

**Default port:** `5001` (override with `SATELLITE_MONITOR_PORT`).

---

## Webhook Configuration

### Configuring Google Earth Engine to call `satellite_monitor`

1. Deploy `satellite_monitor` to a publicly reachable URL (e.g. `https://oracle.yourapp.com`).
2. In your GEE Earth Engine Apps or Cloud Functions configuration, set the webhook target to:
   ```
   https://oracle.yourapp.com/webhook/satellite
   ```
3. Add the `X-GEE-Secret` header with the value from your `GEE_WEBHOOK_SECRET` environment variable.
4. GEE should send a JSON payload matching this schema:

```json
{
  "project_id": "PROJ-001",
  "period": "2024-Q1",
  "satellite_cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
  "tonnes_verified": 500,
  "methodology_score": 85,
  "coordinates": { "lat": -3.4653, "lon": -62.2159 },
  "project_type": "forestry",
  "deforestation_pct": 1.2,
  "reported_tonnes_sequestered": 500
}
```

**Required fields:** `project_id`, `period`, `satellite_cid`. All others are used for validation but will not cause a 400 if absent.

### Local webhook testing with ngrok

To test the webhook locally without deploying:

```bash
# Expose local port 5001 to the internet
ngrok http 5001

# Use the generated URL (e.g. https://abc123.ngrok.io) as your GEE webhook target
```

---

## Expected Log Output

All services emit structured JSON logs to stdout. Each line is a single JSON object.

### Healthy `verification_listener` startup and poll cycle

```json
{"timestamp": "2024-01-15T10:00:00.000Z", "level": "info", "service": "verification_listener", "message": "Verification listener starting — polling every 6 hours"}
{"timestamp": "2024-01-15T10:00:00.100Z", "level": "info", "service": "verification_listener", "message": "Starting verification listener poll cycle"}
{"timestamp": "2024-01-15T10:00:01.200Z", "level": "info", "service": "verification_listener", "message": "Fetched 3 reports from Gold Standard"}
{"timestamp": "2024-01-15T10:00:04.500Z", "level": "info", "service": "verification_listener", "message": "Submitted monitoring data for PROJ-001/2024-Q1 → tx abc123def456..."}
{"timestamp": "2024-01-15T10:00:07.800Z", "level": "info", "service": "verification_listener", "message": "Submitted monitoring data for PROJ-002/2024-Q1 → tx 789xyz..."}
{"timestamp": "2024-01-15T10:00:08.000Z", "level": "info", "service": "verification_listener", "message": "Poll cycle complete"}
```

### Healthy `price_oracle` startup and update cycle

```json
{"timestamp": "2024-01-15T10:00:00.000Z", "level": "info", "service": "price_oracle", "message": "Price oracle starting — updating every 12 hours"}
{"timestamp": "2024-01-15T10:00:00.100Z", "level": "info", "service": "price_oracle", "message": "Starting price oracle update cycle"}
{"timestamp": "2024-01-15T10:00:02.300Z", "level": "info", "service": "price_oracle", "message": "Updated price VCS/2022 → $14.50 USD (tx abc123...)"}
{"timestamp": "2024-01-15T10:00:05.600Z", "level": "info", "service": "price_oracle", "message": "Updated price Gold Standard/2023 → $18.20 USD (tx def456...)"}
{"timestamp": "2024-01-15T10:00:05.700Z", "level": "info", "service": "price_oracle", "message": "Price oracle update cycle complete — 2 prices pushed"}
{"timestamp": "2024-01-15T10:00:05.800Z", "level": "info", "service": "price_oracle", "message": "Approval poller starting — checking every 5 minutes"}
{"timestamp": "2024-01-15T10:00:05.900Z", "level": "info", "service": "price_oracle", "message": "Checking for approved price updates..."}
```

### Healthy `satellite_monitor` startup and webhook receipt

```json
{"timestamp": "2024-01-15T10:00:00.000Z", "level": "info", "service": "satellite_monitor", "message": "Satellite monitor webhook server starting on port 5001"}
{"timestamp": "2024-01-15T10:05:12.000Z", "level": "info", "service": "satellite_monitor", "message": "Submitted satellite monitoring for PROJ-001/2024-Q1 → tx abc123..."}
```

### Warning: missing API credentials (expected in development)

```json
{"timestamp": "2024-01-15T10:00:00.200Z", "level": "warning", "service": "price_oracle", "message": "XPANSIV_API_KEY not set — skipping Xpansiv feed"}
{"timestamp": "2024-01-15T10:00:00.300Z", "level": "warning", "service": "price_oracle", "message": "TOUCAN_API_KEY not set — skipping Toucan feed"}
{"timestamp": "2024-01-15T10:00:00.400Z", "level": "warning", "service": "price_oracle", "message": "No price data available from any feed"}
```

### Alert: satellite contradiction detected

```json
{"timestamp": "2024-01-15T10:05:12.000Z", "level": "error", "service": "satellite_monitor", "message": "🚨 Satellite contradiction detected for project PROJ-001: deforestation in forestry project"}
{"timestamp": "2024-01-15T10:05:15.300Z", "level": "info", "service": "satellite_monitor", "message": "Flagged project PROJ-001 on-chain → tx xyz789..."}
```

### Alert: high price deviation held for approval

```json
{"timestamp": "2024-01-15T10:00:03.000Z", "level": "warning", "service": "price_oracle", "message": "⚠️ High price deviation detected for VCS/2022: 22.5%"}
{"timestamp": "2024-01-15T10:00:03.100Z", "level": "info", "service": "price_oracle", "message": "Price update held in backend for approval: VCS/2022"}
```
