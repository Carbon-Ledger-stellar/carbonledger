# Environment Variable Configuration Guide

> Complete reference for every environment variable used by CarbonLedger — description, type, example value, whether it is required, and how to obtain it.

---

## Table of Contents

- [Quick Setup](#quick-setup)
- [Format Rules](#format-rules)
- [Stellar Network](#stellar-network)
- [Smart Contract Addresses](#smart-contract-addresses)
- [Oracle Keypair](#oracle-keypair)
- [Admin Keypair](#admin-keypair)
- [Database](#database)
- [Authentication](#authentication)
- [IPFS / Pinata](#ipfs--pinata)
- [Satellite Data](#satellite-data)
- [Price Feeds](#price-feeds)
- [Verifier APIs](#verifier-apis)
- [Alerts](#alerts)
- [Frontend (Next.js public variables)](#frontend-nextjs-public-variables)
- [Redis](#redis)
- [Backend](#backend)
- [Oracle Service (Python — additional)](#oracle-service-python--additional)
- [Production-Only Variables](#production-only-variables)

---

## Quick Setup

```bash
cp .env.example .env
# Fill in required values, then verify:
./scripts/verify-setup.sh
```

For a local development environment without external API access, only the **Required** variables marked below are needed. Optional and production-only variables can be left blank or at their defaults.

---

## Format Rules

| Rule | Detail |
|------|--------|
| **Key format** | `SCREAMING_SNAKE_CASE`. No spaces around `=`. |
| **Secret keys** | Stellar secret keys start with `S` and are 56 characters (e.g. `SABCDE...`). Never commit them. |
| **Public keys** | Stellar public keys (G-addresses) start with `G` and are 56 characters. |
| **Contract IDs** | Soroban contract IDs are 56-character StrKey strings starting with `C`. |
| **USDC amounts** | All USDC values stored in the contracts use **stroops** (1 USDC = 10,000,000 stroops). Environment variables that represent USDC amounts follow the same convention unless noted. |
| **URLs** | No trailing slash. Use `https://` for all external services. |
| **Booleans** | Use `true` or `false` (lowercase). |
| **Duration strings** | JWT expiry uses the `ms` library format: `7d`, `1h`, `30m`. |
| **Quoted values** | Values containing spaces (e.g. `NETWORK_PASSPHRASE`) must be quoted in the `.env` file: `NETWORK_PASSPHRASE="Test SDF Network ; September 2015"`. |
| **Frontend prefix** | All variables consumed by Next.js client-side code must be prefixed `NEXT_PUBLIC_`. Variables without this prefix are server-side only. |

---

## Stellar Network

Variables that point to Stellar infrastructure endpoints.

### `STELLAR_NETWORK`

| Property | Value |
|----------|-------|
| **Description** | Selects the Stellar network. Controls which default RPC and Horizon endpoints the oracle and backend use. |
| **Type** | enum |
| **Allowed values** | `testnet`, `mainnet` |
| **Example** | `STELLAR_NETWORK=testnet` |
| **Required** | Yes |
| **How to obtain** | Set to `testnet` for local development. Change to `mainnet` for production. |

---

### `STELLAR_RPC_URL`

| Property | Value |
|----------|-------|
| **Description** | Soroban RPC endpoint. The backend and oracle use this to submit contract transactions and read contract state. |
| **Type** | URL |
| **Example** | `STELLAR_RPC_URL=https://soroban-testnet.stellar.org` |
| **Required** | Yes |
| **How to obtain** | **Testnet:** use `https://soroban-testnet.stellar.org` (public SDF endpoint, no API key required). **Mainnet:** use `https://soroban-mainnet.stellar.org` or a private RPC from [Quicknode](https://www.quicknode.com/chains/stellar), [Ankr](https://www.ankr.com/), or self-hosted. For high-throughput production workloads, the public endpoint has rate limits — use a dedicated provider. |

---

### `STELLAR_HORIZON_URL`

| Property | Value |
|----------|-------|
| **Description** | Stellar Horizon REST API endpoint. Used by the backend indexer to stream ledger events and by the frontend for account queries. |
| **Type** | URL |
| **Example** | `STELLAR_HORIZON_URL=https://horizon-testnet.stellar.org` |
| **Required** | Yes |
| **How to obtain** | **Testnet:** `https://horizon-testnet.stellar.org` (SDF public). **Mainnet:** `https://horizon.stellar.org` (SDF public) or a private Horizon instance. |

---

### `NETWORK_PASSPHRASE`

| Property | Value |
|----------|-------|
| **Description** | Stellar network passphrase. Included in every transaction hash — using the wrong passphrase causes transactions to fail silently on the wrong network. |
| **Type** | string (quoted) |
| **Testnet example** | `NETWORK_PASSPHRASE="Test SDF Network ; September 2015"` |
| **Mainnet example** | `NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"` |
| **Required** | Yes |
| **How to obtain** | These are fixed, well-known strings defined by the Stellar protocol. Copy from the examples above — do not modify. |

---

## Smart Contract Addresses

Filled in after deploying the four Soroban contracts. See the [Contract Deployment section in the README](../README.md#-contract-deployment) for deployment commands.

### `CARBON_REGISTRY_CONTRACT_ID`

| Property | Value |
|----------|-------|
| **Description** | Deployed address of the `carbon_registry` Soroban contract. |
| **Type** | Soroban contract ID (56-char StrKey starting with `C`) |
| **Example** | `CARBON_REGISTRY_CONTRACT_ID=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4` |
| **Required** | Yes |
| **How to obtain** | Returned by `stellar contract deploy` when you deploy `carbon_registry.wasm`. |

---

### `CARBON_CREDIT_CONTRACT_ID`

| Property | Value |
|----------|-------|
| **Description** | Deployed address of the `carbon_credit` Soroban contract. |
| **Type** | Soroban contract ID |
| **Example** | `CARBON_CREDIT_CONTRACT_ID=CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4` |
| **Required** | Yes |
| **How to obtain** | Returned by `stellar contract deploy` when you deploy `carbon_credit.wasm`. |

---

### `CARBON_MARKETPLACE_CONTRACT_ID`

| Property | Value |
|----------|-------|
| **Description** | Deployed address of the `carbon_marketplace` Soroban contract. |
| **Type** | Soroban contract ID |
| **Example** | `CARBON_MARKETPLACE_CONTRACT_ID=CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCSC4` |
| **Required** | Yes |
| **How to obtain** | Returned by `stellar contract deploy` when you deploy `carbon_marketplace.wasm`. |

---

### `CARBON_ORACLE_CONTRACT_ID`

| Property | Value |
|----------|-------|
| **Description** | Deployed address of the `carbon_oracle` Soroban contract. |
| **Type** | Soroban contract ID |
| **Example** | `CARBON_ORACLE_CONTRACT_ID=CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDSC4` |
| **Required** | Yes |
| **How to obtain** | Returned by `stellar contract deploy` when you deploy `carbon_oracle.wasm`. |

---

### `USDC_CONTRACT_ID`

| Property | Value |
|----------|-------|
| **Description** | Contract ID of the USDC token on Stellar. The marketplace uses this for payment settlement. |
| **Type** | Soroban contract ID |
| **Testnet example** | `USDC_CONTRACT_ID=CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| **Required** | Yes |
| **How to obtain** | **Testnet:** the testnet USDC contract ID is published in the [Stellar testnet asset list](https://developers.stellar.org/docs/tokens/usdc). **Mainnet:** the official Circle USDC contract ID is published at [centre.io](https://www.centre.io/usdc-stellar). |

---

## Oracle Keypair

The oracle keypair is used by the Python oracle services to sign monitoring data before submitting it to the `carbon_oracle` contract. The contract stores the public key and verifies each submission's Ed25519 signature.

### `ORACLE_SECRET_KEY`

| Property | Value |
|----------|-------|
| **Description** | Stellar secret key used by oracle services to sign contract transactions. Must match the public key registered in the oracle contract via `initialize()`. |
| **Type** | Stellar secret key (56-char string starting with `S`) |
| **Example** | `ORACLE_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` |
| **Required** | Yes (oracle and backend services) |
| **Security** | Never commit. Rotate via `carbon_oracle.rotate_oracle()` if compromised. See [docs/KEY_ROTATION_PROCEDURES.md](KEY_ROTATION_PROCEDURES.md). |
| **How to obtain** | Generate with `stellar keys generate --network testnet`. The corresponding public key is the `ORACLE_PUBLIC_KEY`. |

---

### `ORACLE_PUBLIC_KEY`

| Property | Value |
|----------|-------|
| **Description** | Stellar public key (G-address) of the oracle keypair. Stored in the oracle contract for signature verification. |
| **Type** | Stellar public key (56-char string starting with `G`) |
| **Example** | `ORACLE_PUBLIC_KEY=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` |
| **Required** | Yes |
| **How to obtain** | Derived from `ORACLE_SECRET_KEY`. Run `stellar keys show <key-name>` or derive programmatically from the secret key using stellar-sdk. |

---

## Admin Keypair

Used to deploy and initialize contracts and perform admin operations (verifier list management, oracle rotation, contract upgrades).

### `ADMIN_SECRET_KEY`

| Property | Value |
|----------|-------|
| **Description** | Stellar secret key for the contract admin account. Authorized to call `initialize()`, `upgrade()`, and other admin functions on all four contracts. |
| **Type** | Stellar secret key |
| **Example** | `ADMIN_SECRET_KEY=SYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY` |
| **Required** | Yes (deployment and admin operations) |
| **Security** | Treat as a root credential. Use a hardware wallet or HSM in production. See [docs/secrets-management.md](secrets-management.md). |
| **How to obtain** | Generate with `stellar keys generate --network testnet`. Fund the account with [friendbot](https://friendbot.stellar.org) on testnet. |

---

### `ADMIN_PUBLIC_KEY`

| Property | Value |
|----------|-------|
| **Description** | Stellar public key (G-address) of the admin account. |
| **Type** | Stellar public key |
| **Example** | `ADMIN_PUBLIC_KEY=GYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY` |
| **Required** | Yes |
| **How to obtain** | Derived from `ADMIN_SECRET_KEY`. |

---

## Database

### `DATABASE_URL`

| Property | Value |
|----------|-------|
| **Description** | PostgreSQL connection string used by Prisma ORM in the backend. |
| **Type** | PostgreSQL connection URL |
| **Format** | `postgresql://<user>:<password>@<host>:<port>/<database>` |
| **Example** | `DATABASE_URL=postgresql://carbonledger:secret@localhost:5432/carbonledger` |
| **Required** | Yes |
| **How to obtain** | Create a local database: `createdb carbonledger`. Then set `<password>` to the value of `POSTGRES_PASSWORD`. For production, use a managed service (AWS RDS, Supabase, Neon). |

---

### `POSTGRES_PASSWORD`

| Property | Value |
|----------|-------|
| **Description** | Password for the `carbonledger` PostgreSQL user. Interpolated into `DATABASE_URL` by Docker Compose. |
| **Type** | string |
| **Example** | `POSTGRES_PASSWORD=changeme` |
| **Required** | Yes (Docker Compose) |
| **How to obtain** | Choose a strong random password. `openssl rand -base64 32` generates a suitable value. |

---

### `DB_POOL_MAX`

| Property | Value |
|----------|-------|
| **Description** | Maximum number of database connections Prisma keeps open simultaneously. |
| **Type** | integer |
| **Default** | `10` |
| **Example** | `DB_POOL_MAX=10` |
| **Required** | No |
| **Rule of thumb** | `(num_cpu_cores × 2) + 1`, capped at `pg_max_connections / num_replicas`. |

---

### `DB_POOL_TIMEOUT_MS`

| Property | Value |
|----------|-------|
| **Description** | Milliseconds to wait for a free connection before Prisma throws `P2024` (connection pool timeout). |
| **Type** | integer (milliseconds) |
| **Default** | `10000` |
| **Example** | `DB_POOL_TIMEOUT_MS=10000` |
| **Required** | No |

---

### `DB_CONNECT_TIMEOUT_S`

| Property | Value |
|----------|-------|
| **Description** | Seconds to wait when opening a new TCP connection to PostgreSQL before timing out. |
| **Type** | integer (seconds) |
| **Default** | `10` |
| **Example** | `DB_CONNECT_TIMEOUT_S=10` |
| **Required** | No |

---

## Authentication

### `JWT_SECRET`

| Property | Value |
|----------|-------|
| **Description** | Secret used to sign and verify JWT access tokens issued by the backend API. |
| **Type** | string (min 32 characters recommended) |
| **Example** | `JWT_SECRET=a-very-long-random-string-here` |
| **Required** | Yes |
| **How to obtain** | Generate with `openssl rand -hex 32`. Rotate by restarting the backend — all existing tokens immediately become invalid. |

---

### `JWT_EXPIRY`

| Property | Value |
|----------|-------|
| **Description** | Lifetime of access tokens issued by the backend. |
| **Type** | duration string (`ms` library format) |
| **Default** | `7d` |
| **Example** | `JWT_EXPIRY=7d` |
| **Required** | No |
| **Allowed formats** | `7d` (7 days), `1h` (1 hour), `30m` (30 minutes), `86400000` (ms integer) |

---

## IPFS / Pinata

Project documentation, satellite imagery, and retirement certificates are stored on IPFS. CarbonLedger uses [Pinata](https://pinata.cloud) as the pinning service.

### `IPFS_API_URL`

| Property | Value |
|----------|-------|
| **Description** | Base URL of the IPFS pinning API. |
| **Type** | URL |
| **Default** | `https://api.pinata.cloud` |
| **Example** | `IPFS_API_URL=https://api.pinata.cloud` |
| **Required** | Yes |
| **How to obtain** | Use the default Pinata URL. If self-hosting IPFS, replace with your node's API URL. |

---

### `IPFS_API_KEY`

| Property | Value |
|----------|-------|
| **Description** | Pinata API key for authenticating upload and pin requests. |
| **Type** | string |
| **Example** | `IPFS_API_KEY=abc123def456` |
| **Required** | Yes |
| **How to obtain** | Sign up at [pinata.cloud](https://pinata.cloud), go to **API Keys** → **New Key**. Grant `pinFileToIPFS` and `pinJSONToIPFS` permissions. |

---

### `IPFS_SECRET_KEY`

| Property | Value |
|----------|-------|
| **Description** | Pinata secret API key paired with `IPFS_API_KEY`. |
| **Type** | string |
| **Example** | `IPFS_SECRET_KEY=xyz789...` |
| **Required** | Yes |
| **How to obtain** | Shown once at API key creation time on the Pinata dashboard. Store it immediately. |

---

## Satellite Data

Used by the oracle service (`satellite_monitor.py`) to receive and validate satellite monitoring data.

### `GOOGLE_EARTH_ENGINE_KEY`

| Property | Value |
|----------|-------|
| **Description** | Service account key for authenticating with the Google Earth Engine API. Used to pull biomass density and land-cover change data for project areas. |
| **Type** | JSON string or path to a JSON key file |
| **Example** | `GOOGLE_EARTH_ENGINE_KEY=/etc/carbonledger/gee-service-account.json` |
| **Required** | Yes (oracle monitoring) |
| **How to obtain** | 1. Create a GCP project. 2. Enable the **Earth Engine API**. 3. Create a **service account** and grant it the `Earth Engine Resource Writer` role. 4. Download the JSON key file. 5. Register the service account email at [code.earthengine.google.com](https://code.earthengine.google.com) (requires approval). |

---

### `PLANET_LABS_API_KEY`

| Property | Value |
|----------|-------|
| **Description** | API key for Planet Labs satellite imagery (secondary validation source). |
| **Type** | string |
| **Example** | `PLANET_LABS_API_KEY=pl.XXXXXXXXX` |
| **Required** | No (GEE is the primary source; Planet Labs is optional supplementary data) |
| **How to obtain** | Register at [planet.com](https://www.planet.com/explorer/) and request API access under the **Education & Research** or **Commercial** tier. |

---

### `GEE_WEBHOOK_SECRET`

| Property | Value |
|----------|-------|
| **Description** | Shared secret used to verify the HMAC-SHA256 signature on incoming Google Earth Engine webhook events received by `satellite_monitor.py`. |
| **Type** | string (min 32 characters) |
| **Example** | `GEE_WEBHOOK_SECRET=webhook-secret-32-chars-minimum` |
| **Required** | Yes (if using GEE webhook mode) |
| **How to obtain** | Generate with `openssl rand -hex 32`. Configure the same value in your GEE webhook endpoint configuration. |

---

## Price Feeds

The oracle service (`price_oracle.py`) fetches carbon credit benchmark prices from market data providers every 12 hours and posts them to the `carbon_oracle` contract.

### `XPANSIV_API_KEY`

| Property | Value |
|----------|-------|
| **Description** | API key for the Xpansiv CBL (Carbon, Biodiversity, and Land) marketplace — the primary carbon credit price data source. |
| **Type** | string |
| **Example** | `XPANSIV_API_KEY=xpansiv_live_...` |
| **Required** | Yes (price feed) |
| **How to obtain** | Contact [Xpansiv](https://xpansiv.com/cbl) to request API access. This requires a commercial relationship or institutional access. Sandbox keys are available for development. |

---

### `TOUCAN_API_KEY`

| Property | Value |
|----------|-------|
| **Description** | API key for Toucan Protocol — used as a secondary price reference for on-chain carbon credit prices. |
| **Type** | string |
| **Example** | `TOUCAN_API_KEY=toucan_...` |
| **Required** | No (supplementary to Xpansiv) |
| **How to obtain** | Register at [toucan.earth](https://toucan.earth) and request API access. |

---

## Verifier APIs

Used by `verification_listener.py` to poll external carbon registry APIs for project attestation signals.

### `GOLD_STANDARD_API_URL`

| Property | Value |
|----------|-------|
| **Description** | Base URL of the Gold Standard Foundation public registry API. |
| **Type** | URL |
| **Example** | `GOLD_STANDARD_API_URL=https://registry.goldstandard.org/api` |
| **Required** | Yes (if Gold Standard projects are registered) |
| **How to obtain** | Published in the [Gold Standard API documentation](https://goldstandard.org/resources). Contact registry@goldstandard.org for API access credentials. |

---

### `GOLD_STANDARD_API_KEY`

| Property | Value |
|----------|-------|
| **Description** | API key for authenticating with the Gold Standard registry API. |
| **Type** | string |
| **Example** | `GOLD_STANDARD_API_KEY=gs_...` |
| **Required** | Yes (if Gold Standard projects are registered) |
| **How to obtain** | Requested from the Gold Standard Foundation. Requires verifier accreditation. |

---

### `VERRA_VCS_API_URL`

| Property | Value |
|----------|-------|
| **Description** | Base URL of the Verra VCS (Verified Carbon Standard) registry API. |
| **Type** | URL |
| **Example** | `VERRA_VCS_API_URL=https://registry.verra.org/app/search/VCS` |
| **Required** | Yes (if VCS projects are registered) |
| **How to obtain** | Published in the [Verra registry documentation](https://verra.org/programs/verified-carbon-standard/). |

---

### `VERRA_VCS_API_KEY`

| Property | Value |
|----------|-------|
| **Description** | API key for authenticating with the Verra VCS registry API. |
| **Type** | string |
| **Example** | `VERRA_VCS_API_KEY=verra_...` |
| **Required** | Yes (if VCS projects are registered) |
| **How to obtain** | Request from Verra. Requires verifier registration at [verra.org](https://verra.org). |

---

## Alerts

### `ADMIN_ALERT_WEBHOOK`

| Property | Value |
|----------|-------|
| **Description** | Webhook URL that receives admin alerts — including oracle price deviation warnings (>15% single-update change) and project flagging events. |
| **Type** | URL (HTTPS) |
| **Example** | `ADMIN_ALERT_WEBHOOK=https://hooks.slack.com/services/T.../B.../...` |
| **Required** | No (alerts are skipped if not set) |
| **How to obtain** | Create an **Incoming Webhook** in your Slack workspace at `api.slack.com/apps`, or use any webhook endpoint (Discord, PagerDuty, custom). |

---

## Frontend (Next.js public variables)

These variables are embedded in the browser bundle at build time. They must not contain secrets. All are prefixed `NEXT_PUBLIC_`.

### `NEXT_PUBLIC_STELLAR_NETWORK`

| Property | Value |
|----------|-------|
| **Description** | Network name displayed in the UI and used to configure Freighter wallet. |
| **Type** | enum |
| **Allowed values** | `testnet`, `mainnet` |
| **Example** | `NEXT_PUBLIC_STELLAR_NETWORK=testnet` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_HORIZON_URL`

| Property | Value |
|----------|-------|
| **Description** | Horizon API URL used by the frontend for account balance and transaction queries. |
| **Type** | URL |
| **Example** | `NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_SOROBAN_RPC_URL`

| Property | Value |
|----------|-------|
| **Description** | Soroban RPC URL the frontend uses for direct contract reads (e.g. browsing listings, looking up certificates without signing). |
| **Type** | URL |
| **Example** | `NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_API_URL`

| Property | Value |
|----------|-------|
| **Description** | Base URL of the CarbonLedger backend REST API. Used by all frontend API calls. |
| **Type** | URL |
| **Example** | `NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_REGISTRY_CONTRACT`

| Property | Value |
|----------|-------|
| **Description** | `carbon_registry` contract ID (mirrors `CARBON_REGISTRY_CONTRACT_ID` for browser use). |
| **Type** | Soroban contract ID |
| **Example** | `NEXT_PUBLIC_REGISTRY_CONTRACT=CA...` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_CREDIT_CONTRACT`

| Property | Value |
|----------|-------|
| **Description** | `carbon_credit` contract ID for browser use. |
| **Type** | Soroban contract ID |
| **Example** | `NEXT_PUBLIC_CREDIT_CONTRACT=CB...` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_MARKETPLACE_CONTRACT`

| Property | Value |
|----------|-------|
| **Description** | `carbon_marketplace` contract ID for browser use. |
| **Type** | Soroban contract ID |
| **Example** | `NEXT_PUBLIC_MARKETPLACE_CONTRACT=CC...` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_ORACLE_CONTRACT`

| Property | Value |
|----------|-------|
| **Description** | `carbon_oracle` contract ID for browser use (used by the Oracle Status component). |
| **Type** | Soroban contract ID |
| **Example** | `NEXT_PUBLIC_ORACLE_CONTRACT=CD...` |
| **Required** | Yes |

---

### `NEXT_PUBLIC_USDC_CONTRACT`

| Property | Value |
|----------|-------|
| **Description** | USDC token contract ID for browser use. |
| **Type** | Soroban contract ID |
| **Example** | `NEXT_PUBLIC_USDC_CONTRACT=CBIELTK6...` |
| **Required** | Yes |

---

## Redis

Redis is used by the backend's BullMQ job queue for certificate generation, IPFS pinning retries, and oracle update jobs.

### `REDIS_HOST`

| Property | Value |
|----------|-------|
| **Description** | Hostname or IP address of the Redis server. |
| **Type** | string |
| **Default** | `localhost` |
| **Example** | `REDIS_HOST=localhost` |
| **Required** | Yes |

---

### `REDIS_PORT`

| Property | Value |
|----------|-------|
| **Description** | TCP port Redis listens on. |
| **Type** | integer |
| **Default** | `6379` |
| **Example** | `REDIS_PORT=6379` |
| **Required** | Yes |

---

### `REDIS_PASSWORD`

| Property | Value |
|----------|-------|
| **Description** | Redis authentication password. Leave blank if Redis is running without auth (local dev only). |
| **Type** | string |
| **Example** | `REDIS_PASSWORD=redis-secret` |
| **Required** | No (local dev) / Yes (production) |
| **How to obtain** | Set in your Redis configuration (`requirepass` directive) or via your managed Redis provider (Upstash, AWS ElastiCache, Redis Cloud). |

---

## Backend

### `PORT`

| Property | Value |
|----------|-------|
| **Description** | TCP port the NestJS backend API listens on. |
| **Type** | integer |
| **Default** | `3001` |
| **Example** | `PORT=3001` |
| **Required** | No |

---

### `FRONTEND_URL`

| Property | Value |
|----------|-------|
| **Description** | Origin URL of the Next.js frontend. Used in CORS configuration and email links. |
| **Type** | URL |
| **Default** | `http://localhost:3000` |
| **Example** | `FRONTEND_URL=http://localhost:3000` |
| **Required** | Yes |

---

### `ALLOWED_ORIGINS`

| Property | Value |
|----------|-------|
| **Description** | Comma-separated list of origins allowed by the CORS policy. The backend rejects requests from any origin not in this list. |
| **Type** | comma-separated URLs |
| **Example** | `ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001,https://app.carbonledger.com` |
| **Required** | Yes |

---

### `BODY_SIZE_LIMIT`

| Property | Value |
|----------|-------|
| **Description** | Maximum allowed size of JSON request bodies. Uses the `express body-parser` size format. |
| **Type** | size string |
| **Default** | `10kb` |
| **Example** | `BODY_SIZE_LIMIT=10kb` |
| **Required** | No |
| **Allowed formats** | `10kb`, `1mb`, `500b`, or a byte integer like `10240`. |

---

## Oracle Service (Python — additional)

The Python oracle services (`verification_listener.py`, `price_oracle.py`, `satellite_monitor.py`) read some additional variables not listed in `.env.example`. Set these in the same `.env` file or as system environment variables.

### `BACKEND_API_URL`

| Property | Value |
|----------|-------|
| **Description** | Base URL of the CarbonLedger backend API. The oracle service posts monitoring results to the backend indexer. |
| **Type** | URL |
| **Example** | `BACKEND_API_URL=http://localhost:3001/api/v1` |
| **Required** | Yes (oracle services) |

---

### `BACKEND_JWT_TOKEN`

| Property | Value |
|----------|-------|
| **Description** | Pre-issued JWT token for the oracle service account. The oracle uses this to authenticate against the backend API when reporting monitoring results. |
| **Type** | JWT string |
| **Example** | `BACKEND_JWT_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| **Required** | Yes (oracle services) |
| **How to obtain** | Issue a long-lived service token from the backend using an admin account, or configure a dedicated oracle user and generate a token via `POST /api/v1/auth/login`. |

---

## Production-Only Variables

These variables are not in `.env.example` because they are not needed for local development. Configure them for staging and production deployments.

| Variable | Description | Example |
|----------|-------------|---------|
| `NODE_ENV` | Node.js environment mode. Set to `production` to disable debug logging and enable performance optimisations. | `NODE_ENV=production` |
| `LOG_LEVEL` | Minimum log level for the backend (`error`, `warn`, `info`, `debug`, `verbose`). | `LOG_LEVEL=info` |
| `JWT_REFRESH_SECRET` | Separate secret for signing refresh tokens. Must differ from `JWT_SECRET`. | `JWT_REFRESH_SECRET=...` |
| `JWT_REFRESH_EXPIRY` | Lifetime of refresh tokens. | `JWT_REFRESH_EXPIRY=30d` |
| `AWS_REGION` | AWS region for CloudWatch log delivery. | `AWS_REGION=us-east-1` |
| `AWS_CLOUDWATCH_GROUP` | CloudWatch log group name for structured backend logs. | `AWS_CLOUDWATCH_GROUP=/carbonledger/backend` |
| `EMAIL_FROM` | Sender address used for outbound emails (retirement certificate delivery, alerts). | `EMAIL_FROM=noreply@carbonledger.com` |
| `REDIS_SENTINELS` | Comma-separated `host:port` pairs for Redis Sentinel failover configuration. | `REDIS_SENTINELS=sentinel1:26379,sentinel2:26379` |
| `REDIS_SENTINEL_NAME` | Name of the Redis master in Sentinel configuration. | `REDIS_SENTINEL_NAME=mymaster` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network passphrase exposed to browser for Freighter wallet configuration. | `NEXT_PUBLIC_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"` |
| `NEXT_PUBLIC_APP_URL` | Canonical public URL of the app. Used for generating QR code links in certificates. | `NEXT_PUBLIC_APP_URL=https://app.carbonledger.com` |
