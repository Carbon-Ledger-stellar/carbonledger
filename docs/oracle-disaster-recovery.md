# Oracle Bridge Disaster Recovery: Warm Standby with Automatic Failover

## Architecture Overview

The oracle bridge consists of three Python services:

| Service | Role |
|---------|------|
| `verification_listener.py` | Processes verification events from the backend |
| `price_oracle.py` | Fetches and submits benchmark carbon credit prices |
| `satellite_monitor.py` | Receives satellite webhooks and submits monitoring data |

Each service runs in one of two modes:

- **Primary**: Processes events and submits on-chain transactions.
- **Standby (Warm)**: Processes events to maintain up-to-date local state but does **not** submit on-chain. This ensures the standby is always ready to take over.

## Failover Mechanism

### Leader Election

Leader election uses a **Redis distributed lock** (`carbonledger:oracle:failover`). The primary instance acquires and holds the lock. Standby instances attempt to acquire the lock when the primary is detected as failed.

### Heartbeat & Failure Detection

The primary writes a heartbeat record to the `oracle_failover_state` PostgreSQL table on each cycle. Standby instances monitor the heartbeat timestamp. If the primary's last heartbeat exceeds the `FAILOVER_HEARTBEAT_TTL` (default: 60 seconds), the standby considers the primary failed.

### Promotion

When a standby detects primary failure:

1. It attempts to acquire the Redis lock.
2. On success, it updates its role to `primary` in PostgreSQL.
3. It begins submitting on-chain transactions.
4. The promotion completes within the `FAILOVER_PROMOTION_TIMEOUT` (default: 120 seconds).

### Anti-Duplication Guarantee

No on-chain submissions are duplicated during failover because:

- The Redis lock ensures only one instance holds the primary role at a time.
- The standby does not submit on-chain while in standby mode.
- The lock TTL (120s) is shorter than the heartbeat timeout (60s × 2), ensuring a stalled primary's lock expires before the standby promotes.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `FAILOVER_LOCK_KEY` | `carbonledger:oracle:failover` | Redis lock key for leader election |
| `FAILOVER_LOCK_TTL` | `120` | Lock TTL in seconds |
| `FAILOVER_HEARTBEAT_TTL` | `60` | Heartbeat timeout in seconds |
| `FAILOVER_PROMOTION_TIMEOUT` | `120` | Max seconds to wait before promoting |
| `FAILOVER_INSTANCE_ID` | `hostname:pid:uuid` | Unique instance identifier |
| `FAILOVER_SERVICE_NAME` | `oracle` | Service name for logging |
| `ORACLE_STANDBY_MODE` | `false` | Force standby mode (for testing) |

## Database Schema

The `oracle_failover_state` table tracks the role and heartbeat of each instance:

```sql
CREATE TABLE oracle_failover_state (
    id              SERIAL PRIMARY KEY,
    service_name    VARCHAR(50)  NOT NULL,
    instance_id     VARCHAR(200) NOT NULL,
    role            VARCHAR(10)  NOT NULL CHECK (role IN ('primary', 'standby')),
    last_heartbeat  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    promoted_at     TIMESTAMPTZ,
    failover_count  INTEGER      NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (service_name, instance_id)
);
```

## Deployment

### Docker Compose

The `docker-compose.yml` defines both primary and standby services for each oracle component:

- `oracle_verification` — primary verification listener
- `oracle_verification_standby` — warm standby verification listener
- `oracle_price` — primary price oracle
- `oracle_price_standby` — warm standby price oracle
- `oracle_satellite` — primary satellite monitor
- `oracle_satellite_standby` — warm standby satellite monitor

Standby services use the same Docker image and configuration as their primary counterparts, with the `ORACLE_STANDBY_MODE=true` environment variable set.

### Systemd

For bare-metal deployments, systemd service files are provided in `oracle/systemd/`. The standby services use the same unit file with `ORACLE_STANDBY_MODE=true` set in the environment file.

## Automated Failover Test

The test `oracle/test_failover.py` verifies:

1. A standby instance detects primary failure within the timeout.
2. The standby promotes itself to primary.
3. No on-chain submissions are duplicated during failover.
4. The promotion completes within 2 minutes.

Run the test:

```bash
cd oracle
python -m pytest test_failover.py -v
```

## CI Integration

The failover test runs in CI as part of the oracle test suite. The test:

1. Starts a primary instance and a standby instance.
2. Simulates primary failure by stopping the primary process.
3. Verifies the standby promotes within 120 seconds.
4. Verifies no duplicate on-chain submissions occurred.

## Recovery Procedures

### Primary Recovery

When the original primary recovers:

1. It attempts to acquire the Redis lock.
2. If the standby is still primary, the recovered instance becomes standby.
3. The recovered instance syncs state from PostgreSQL.

### Manual Failover

To manually trigger a failover:

```bash
# On the standby instance
export ORACLE_STANDBY_MODE=false
python3 verification_listener.py
```

Or demote the primary explicitly:

```python
from oracle.failover_manager import FailoverManager
fm = FailoverManager(redis_client, db_url)
fm.demote()
```

## Monitoring

Key metrics to monitor:

- `oracle_failover_state_role` — current role of each instance (primary/standby)
- `oracle_failover_promotion_count` — number of promotions per service
- `oracle_failover_last_heartbeat` — timestamp of last heartbeat from each instance
- `oracle_submissions_total` — on-chain submission count (should not increase during standby)