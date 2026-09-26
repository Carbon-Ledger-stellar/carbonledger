# CarbonLedger Stellar Mainnet Deployment Runbook

This runbook is for an approved production release of CarbonLedger services and Soroban contracts to Stellar mainnet. Mainnet transactions and contract deployments are irreversible. A second operator must review the checklist and transaction details before any signing key is used.

## Pre-deployment checklist

- [ ] Change ticket, release commit, deployment owner, and rollback owner recorded.
- [ ] Security review/audit is complete for the exact contract WASM and application images.
- [ ] Staging deployment is healthy and the release has been smoke-checked there.
- [ ] Production host has Docker Compose v2, `cargo`, `stellar` CLI, `curl`, `jq`, and sufficient disk/RAM.
- [ ] Production database backup completed and restore procedure is known to work.
- [ ] Database migrations reviewed for backward compatibility. During a rolling deployment, use additive changes only.
- [ ] Mainnet admin and oracle secret keys are available from the approved secret manager or signing process. Do not commit or print them.
- [ ] The deployer account is funded with enough XLM for deployment, initialization, and fees/rent.
- [ ] Contract IDs, WASM SHA-256 hashes, image digests, and release commit are recorded.
- [ ] DNS, TLS certificates, firewall rules, and `ALLOWED_ORIGINS` point to production hosts.
- [ ] Grafana, Loki, alert routing, error-log notifications, and on-call escalation are reachable.
- [ ] A maintenance/rollback communication is ready and stakeholders have been notified.

## 1. Mainnet environment setup

Run commands from the repository root on the production host. Store `.env` outside source control with permissions restricted to the deployment user. Use the repository `.env.example` as the complete variable reference, but replace every testnet or development default.

```bash
cp .env.example .env
chmod 600 .env
```

Set at least the following production values:

```dotenv
# Stellar mainnet
STELLAR_NETWORK=mainnet
STELLAR_RPC_URL=https://soroban-mainnet.stellar.org
STELLAR_HORIZON_URL=https://horizon.stellar.org
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015

# Contract IDs, populated after deployment or from the approved release manifest
CARBON_REGISTRY_CONTRACT_ID=C...
CARBON_CREDIT_CONTRACT_ID=C...
CARBON_MARKETPLACE_CONTRACT_ID=C...
CARBON_ORACLE_CONTRACT_ID=C...
USDC_CONTRACT_ID=C...

# Mainnet public keys; secret keys come from the secret manager
ADMIN_PUBLIC_KEY=G...
ORACLE_PUBLIC_KEY=G...
ADMIN_SECRET_KEY=...
ORACLE_SECRET_KEY=...

# Required backend settings
DATABASE_URL=postgresql://carbonledger:<password>@pgbouncer:5432/carbonledger
POSTGRES_PASSWORD=<strong-production-password>
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=<strong-production-password>
JWT_SECRET=<random-production-secret>
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://app.carbonledger.com
ALLOWED_ORIGINS=https://app.carbonledger.com
LOG_LEVEL=info

# Frontend build/runtime settings
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
NEXT_PUBLIC_HORIZON_URL=https://horizon.stellar.org
NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-mainnet.stellar.org
NEXT_PUBLIC_API_URL=https://api.carbonledger.com/api/v1
NEXT_PUBLIC_REGISTRY_CONTRACT=C...
NEXT_PUBLIC_CREDIT_CONTRACT=C...
NEXT_PUBLIC_MARKETPLACE_CONTRACT=C...
NEXT_PUBLIC_ORACLE_CONTRACT=C...
NEXT_PUBLIC_USDC_CONTRACT=C...

# Operations and integrations
ADMIN_ALERT_WEBHOOK=<secret webhook URL>
GRAFANA_PASSWORD=<strong-password>
BACKUP_S3_BUCKET=<production-backup-bucket>
AWS_REGION=<backup-region>
OTEL_ENABLED=true
OTEL_SERVICE_NAME=carbonledger-backend
```

Also configure the production values required by the enabled integrations: IPFS/Pinata, SMTP, verifier APIs, price feeds, satellite data, `BACKEND_API_URL`, `BACKEND_JWT_TOKEN`, `GEE_WEBHOOK_SECRET`, and any `DB_POOL_*` or resource-limit overrides. Never use `.env.example` placeholders in production. Verify that no value contains a testnet URL or the development JWT fallback.

Before starting containers, review the resolved Compose configuration without exposing secrets in logs:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml config
```

## 2. Contract deployment sequence

The dependency order is:

1. `carbon_registry` (no contract dependency)
2. `carbon_credit` (references the registry)
3. `carbon_marketplace` (references the credit contract)
4. `carbon_oracle` (references the registry and oracle public key)

Build the exact release source and record each WASM hash. Deploy each contract with the mainnet network and passphrase. The `stellar contract deploy` command returns a new contract ID; preserve the transaction/contract record in the release manifest.

```bash
cd contracts
cargo build --target wasm32-unknown-unknown --release --workspace
cd ..

export NETWORK=mainnet
export RPC_URL=https://soroban-mainnet.stellar.org
export PASSPHRASE='Public Global Stellar Network ; September 2015'
export WASM_DIR=contracts/target/wasm32-unknown-unknown/release

stellar contract deploy --wasm "$WASM_DIR/carbon_registry.wasm" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" \
  --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE"
# Save output as CARBON_REGISTRY_CONTRACT_ID before continuing.

stellar contract deploy --wasm "$WASM_DIR/carbon_credit.wasm" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" \
  --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE"
# Save output as CARBON_CREDIT_CONTRACT_ID.

stellar contract deploy --wasm "$WASM_DIR/carbon_marketplace.wasm" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" \
  --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE"
# Save output as CARBON_MARKETPLACE_CONTRACT_ID.

stellar contract deploy --wasm "$WASM_DIR/carbon_oracle.wasm" \
  --source "$ADMIN_SECRET_KEY" --network "$NETWORK" \
  --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE"
# Save output as CARBON_ORACLE_CONTRACT_ID.
```

Verify every returned ID before initialization:

```bash
for contract_id in "$CARBON_REGISTRY_CONTRACT_ID" "$CARBON_CREDIT_CONTRACT_ID" "$CARBON_MARKETPLACE_CONTRACT_ID" "$CARBON_ORACLE_CONTRACT_ID"; do
  stellar contract info --id "$contract_id" --network mainnet \
    --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE"
done
```

Initialize only after all IDs have been independently reviewed. Each initialization is one mainnet transaction:

```bash
stellar contract invoke --id "$CARBON_REGISTRY_CONTRACT_ID" --source "$ADMIN_SECRET_KEY" \
  --network mainnet --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE" -- \
  initialize --admin "$ADMIN_PUBLIC_KEY"

stellar contract invoke --id "$CARBON_CREDIT_CONTRACT_ID" --source "$ADMIN_SECRET_KEY" \
  --network mainnet --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE" -- \
  initialize --admin "$ADMIN_PUBLIC_KEY" --registry "$CARBON_REGISTRY_CONTRACT_ID"

stellar contract invoke --id "$CARBON_MARKETPLACE_CONTRACT_ID" --source "$ADMIN_SECRET_KEY" \
  --network mainnet --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE" -- \
  initialize --admin "$ADMIN_PUBLIC_KEY" --credit_contract "$CARBON_CREDIT_CONTRACT_ID"

stellar contract invoke --id "$CARBON_ORACLE_CONTRACT_ID" --source "$ADMIN_SECRET_KEY" \
  --network mainnet --rpc-url "$RPC_URL" --network-passphrase "$PASSPHRASE" -- \
  initialize --admin "$ADMIN_PUBLIC_KEY" --oracle "$ORACLE_PUBLIC_KEY" \
  --registry "$CARBON_REGISTRY_CONTRACT_ID"
```

Update the production secret/config store with the final IDs only after verifying the initialization transactions. Do not reuse testnet IDs.

## 3. Database migration and application deployment

Take a backup before migration and confirm the backup timestamp and location. Review the generated SQL and apply migrations from the release image with Prisma:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml pull

docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml run --rm backend \
  sh -c 'npx prisma migrate deploy'
```

Deploy the application using the repository rolling deployment script. It pulls backend/frontend images, runs migration, replaces backend and frontend replicas, waits for health, and checks `/health`:

```bash
./scripts/deploy.sh
```

For a manual rollout, use the same Compose files and replace one service at a time. Do not remove the previous healthy replica until the replacement passes its container healthcheck:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps --scale backend=2 backend
# Confirm backend is healthy, then repeat for frontend.
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml ps
```

Do not apply destructive schema changes during this rollout. For a rename/drop, use an expand-and-contract sequence across separate releases. The backend container also runs `npx prisma migrate deploy` on startup; ensure migrations are safe if more than one replica starts concurrently.

## 4. Health checks and verification

Replace hostnames with the production URLs and keep responses free of secrets:

| Endpoint | Purpose | Expected result |
|---|---|---|
| `GET https://api.carbonledger.com/health` | Liveness/basic API check | HTTP 200 and `status: "ok"` |
| `GET https://api.carbonledger.com/health/ready` | DB, Redis, Horizon, and Soroban RPC readiness | HTTP 200 and all checks `ok`; HTTP 503 means do not route traffic |
| `GET https://api.carbonledger.com/metrics` | Prometheus-compatible backend counters | HTTP 200, text format |
| `GET https://api.carbonledger.com/api/v1/observability/metrics` | Application dashboard metrics | HTTP 200 |
| `GET https://app.carbonledger.com/` | Frontend availability | HTTP 200 |
| `GET https://satellite.carbonledger.com/health` | Satellite monitor health, if externally exposed | HTTP 200 |

```bash
curl --fail --silent --show-error https://api.carbonledger.com/health | jq .
curl --fail --silent --show-error https://api.carbonledger.com/health/ready | jq .
curl --fail --silent --show-error https://api.carbonledger.com/metrics | head
curl --fail --silent --show-error https://app.carbonledger.com/ >/dev/null
```

Also verify `docker compose ps` shows backend, frontend, PostgreSQL/PgBouncer, Redis, oracle, Loki, and Grafana services healthy or running as intended. Confirm the four contract IDs in application configuration match the approved release manifest and inspect mainnet transaction status in a trusted Stellar explorer or CLI.

## 5. Monitoring and alerting

Start monitoring before traffic is enabled and watch it continuously through the release window:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml logs --since=15m backend oracle_verification oracle_price oracle_satellite

docker stats --no-stream
```

- **Loki/Promtail/Grafana:** Docker services emit JSON logs to stdout; Promtail ships them to Loki and Grafana provides dashboards and alerts. Use the production Grafana URL, not the default development password.
- **Backend error logs:** In Grafana Explore, query `{service="backend"} | json | level="error"`. Filter by `correlationId` or `traceId` when following a request. The `X-Correlation-ID` response header links API errors to logs.
- **Metrics:** Scrape `/metrics` with the production Prometheus/Grafana agent. Watch contract call failures, database pool pressure, request latency, and service availability.
- **Alerts:** Confirm routing for backend/oracle errors, readiness failures, database connectivity, Redis failures, disk usage, container restarts, and elevated HTTP 5xx/429 responses. `ADMIN_ALERT_WEBHOOK` must reach the on-call channel.
- **Tracing:** When enabled, confirm traces arrive at the configured OTLP/Jaeger collector.

Keep the release under observation for at least the agreed production window. Record timestamps, alerts, contract transaction hashes, and operator decisions.

## 6. Rollback procedures

### Backend or frontend

The previous image must remain available until the release is accepted. Stop a bad rollout and restore the previously approved image digest/tag, then bring up the affected service:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps backend   # after pinning the previous backend image

docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml \
  up -d --no-deps frontend  # after pinning the previous frontend image
```

Check `/health/ready` before restoring traffic. The deployment script attempts a backend rollback on failure, but the operator must verify the result and perform the frontend rollback separately if needed.

### Database

Never roll back a migration by deleting rows or manually reversing SQL without an approved recovery plan. If the migration is backward-compatible, roll back application images while leaving the schema in place. If data/schema corruption occurred, stop writes, preserve logs, identify the last good backup, and restore to a separate database or perform the approved point-in-time recovery. Validate the restored database before switching `DATABASE_URL`, then restart services and check `/health/ready`.

### Stellar contracts

A deployed Soroban contract cannot be deleted or transactionally rolled back. Do not try to overwrite its code or reuse an incorrect ID. For a faulty new deployment:

1. Stop initialization or dependent application rollout immediately.
2. Keep the last known-good contract IDs in the production configuration.
3. Build and independently review a corrected WASM artifact.
4. Deploy the corrected contract as a new contract and initialize it with the correct dependencies.
5. Update backend/frontend/oracle contract IDs atomically through the secret/config store.
6. Use the canary controls (`CANARY_CONTRACT_ID` and `CANARY_TRAFFIC_PCT`) where supported, starting at zero and increasing only after observation.
7. Record the new IDs and transaction hashes. Treat the abandoned contract as permanently deployed and disable any affected operations until reviewed.

If a bad initialization has already changed state, pause writes and use the contract’s authorized administrative recovery operation, if one exists and has been approved. Never guess at a compensating transaction on mainnet.

### Oracle services

Scale down or stop the affected oracle service while leaving the standby available, then restore the previous image/configuration. Confirm the oracle public key, contract ID, RPC URL, and database connectivity before re-enabling writes. Watch oracle error logs and monitoring freshness after failover.

### Configuration and secrets

Restore the previous version of the production secret/configuration bundle, restart only affected services, and verify that all four contract IDs and network URLs are internally consistent. Rotate any secret that may have been exposed; do not put the replacement secret in shell history or logs.

## Completion record

Record the following with the release ticket:

- Release commit and image digests
- WASM SHA-256 hashes and contract IDs
- Deployment and initialization transaction hashes
- Migration names and backup/PITR reference
- Health-check results and monitoring start time
- Any alerts, mitigations, or rollback actions
- Operator and reviewer sign-off
