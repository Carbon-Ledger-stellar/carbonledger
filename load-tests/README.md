# Load Tests

This directory contains [k6](https://k6.io/) load-test scripts for the marketplace API. Each script exercises a different set of scenarios and enforces SLO thresholds; a run fails (non-zero exit) if any threshold is breached.

## Prerequisites

1. **Install k6** — see the [k6 installation guide](https://k6.io/docs/get-started/installation/).
2. **Seed load-test data** — populate the database with the buyers, listings, and inventory the scripts expect:

   ```bash
   ./scripts/seed-loadtest.sh
   ```

3. **Generate buyer JWTs** — the marketplace scripts authenticate as pre-seeded buyers:

   ```bash
   node backend/scripts/generate-loadtest-buyer-jwts.js
   ```

   This writes the JWTs to a file (see the script output for the exact path) that you pass to k6 via the `JWT` environment variable.

4. **Environment variables**

   | Variable   | Description                                                        | Example                     |
   |------------|--------------------------------------------------------------------|-----------------------------|
   | `BASE_URL` | Base URL of the API under test                                     | `http://localhost:3000`     |
   | `JWT`      | A buyer JWT (or path to the generated JWT file, per script usage)  | `eyJhbGciOi...`             |

## Scenarios and SLO thresholds

### `load-test.js`

General API load profile.

| Scenario          | Description                                              |
|-------------------|----------------------------------------------------------|
| `baseline_100`    | Steady-state traffic at 100 VUs                          |
| `stress_500`      | Stress ramp to 500 VUs                                   |
| `spike`           | Sudden traffic spike                                     |
| `purchase_soak`   | Long-running purchase flow soak test                     |
| `bulk_retirement` | Bulk retirement endpoint under load                      |

**SLO thresholds**

- `p95 < 500 ms` at 100 VUs
- `p99 < 2000 ms`
- `error_rate < 1%`

### `marketplace.k6.js`

Marketplace browsing and purchasing flows.

| Scenario               | Description                                    |
|------------------------|------------------------------------------------|
| `marketplace_browse`   | 500 VUs for 5 minutes browsing listings        |
| `purchase_stress`      | 50 VUs for 5 minutes purchasing                |
| `bulk_retirement_spike`| Spike on the bulk retirement endpoint          |

**SLO thresholds**

- `p99 < 2000 ms`
- `error_rate < 1%`

### `marketplace-bulk-purchase.k6.js`

Bulk-purchase and rate-limit behavior.

| Scenario                | Description                                                       |
|-------------------------|-------------------------------------------------------------------|
| `single_purchase_baseline` | Single-buyer purchase baseline                                 |
| `concurrent_buyers_100` | 100 concurrent buyers                                             |
| `bulk_purchase_stress`  | Sustained bulk-purchase load                                      |
| `rate_limit_exhaustion` | Drives traffic to exhaust rate limits and verifies 429 handling   |

**SLO thresholds**

- `p99 < 500 ms` at up to 100 RPS
- `error_rate < 1%`

### `pause-feature-load-test.js`

Pause/unpause feature under concurrent load.

| Scenario                          | Description                                              |
|-----------------------------------|----------------------------------------------------------|
| 1000 simultaneous pause/unpause   | 1000 simultaneous pause/unpause queries                  |
| 35 arrivals/s for 30s             | Constant arrival rate of 35 iterations/second for 30s    |

## Running locally

Run any script directly with k6, passing the required environment variables:

```bash
k6 run load-tests/load-test.js \
  -e BASE_URL=http://localhost:3000 \
  -e JWT="$JWT"
```

```bash
k6 run load-tests/marketplace.k6.js \
  -e BASE_URL=http://localhost:3000 \
  -e JWT="$JWT"
```

```bash
k6 run load-tests/marketplace-bulk-purchase.k6.js \
  -e BASE_URL=http://localhost:3000 \
  -e JWT="$JWT"
```

```bash
k6 run load-tests/pause-feature-load-test.js \
  -e BASE_URL=http://localhost:3000 \
  -e JWT="$JWT"
```

To capture results for later analysis, add a JSON output:

```bash
k6 run load-tests/load-test.js \
  -e BASE_URL=http://localhost:3000 \
  -e JWT="$JWT" \
  --out json=results/load-test.json
```

## Running in CI

The load-test suite is invoked by the CI pipeline after the application is deployed to the load-test environment. The pipeline:

1. Runs `scripts/seed-loadtest.sh` against the target environment.
2. Runs `backend/scripts/generate-loadtest-buyer-jwts.js` to mint buyer JWTs.
3. Executes each script in this directory with `BASE_URL` pointing at the deployed environment and `JWT` set to a generated token, e.g.:

   ```bash
   k6 run load-tests/load-test.js -e BASE_URL="$BASE_URL" -e JWT="$JWT" --out json=results/load-test.json
   k6 run load-tests/marketplace.k6.js -e BASE_URL="$BASE_URL" -e JWT="$JWT" --out json=results/marketplace.json
   k6 run load-tests/marketplace-bulk-purchase.k6.js -e BASE_URL="$BASE_URL" -e JWT="$JWT" --out json=results/marketplace-bulk-purchase.json
   k6 run load-tests/pause-feature-load-test.js -e BASE_URL="$BASE_URL" -e JWT="$JWT" --out json=results/pause-feature.json
   ```

A run fails the CI job if any SLO threshold listed above is breached. JSON result artifacts are uploaded for inspection.