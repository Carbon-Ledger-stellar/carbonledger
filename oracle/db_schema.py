"""
Database schema definitions for oracle failover, schema versioning and liveness.

Provides SQL DDL for the tables required by the disaster recovery, methodology
schema versioning and liveness-monitoring features.
"""

FAILOVER_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS oracle_failover_state (
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

CREATE INDEX IF NOT EXISTS idx_oracle_failover_service
    ON oracle_failover_state (service_name);

CREATE INDEX IF NOT EXISTS idx_oracle_failover_role
    ON oracle_failover_state (role);

CREATE OR REPLACE FUNCTION oracle_failover_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_oracle_failover_updated_at ON oracle_failover_state;
CREATE TRIGGER trg_oracle_failover_updated_at
    BEFORE UPDATE ON oracle_failover_state
    FOR EACH ROW
    EXECUTE FUNCTION oracle_failover_updated_at();
"""

SCHEMA_REGISTRY_SQL = """
CREATE TABLE IF NOT EXISTS methodology_schemas (
    id              SERIAL PRIMARY KEY,
    methodology     VARCHAR(100) NOT NULL,
    version         INTEGER      NOT NULL,
    schema_name     VARCHAR(200) NOT NULL,
    schema_body     JSONB        NOT NULL,
    backward_compat BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      VARCHAR(100) DEFAULT 'system',
    UNIQUE (methodology, version)
);

CREATE INDEX IF NOT EXISTS idx_methodology_schemas_methodology
    ON methodology_schemas (methodology);

CREATE INDEX IF NOT EXISTS idx_methodology_schemas_version
    ON methodology_schemas (methodology, version);

CREATE TABLE IF NOT EXISTS oracle_submissions (
    id                  SERIAL PRIMARY KEY,
    submission_id       VARCHAR(200) UNIQUE,
    project_id          VARCHAR(200) NOT NULL,
    period              VARCHAR(100) NOT NULL,
    tonnes_verified     NUMERIC(30, 10) NOT NULL,
    methodology         VARCHAR(100) NOT NULL,
    methodology_score   INTEGER NOT NULL,
    satellite_cid       VARCHAR(500),
    schema_version      INTEGER NOT NULL DEFAULT 1,
    submitted_by        VARCHAR(200),
    submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    on_chain_tx_hash    VARCHAR(200),
    on_chain_submitted  BOOLEAN DEFAULT false,
    on_chain_timestamp  TIMESTAMPTZ,
    divergence_type     VARCHAR(50),
    divergence_resolved BOOLEAN DEFAULT false,
    escalated           BOOLEAN DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oracle_submissions_project
    ON oracle_submissions (project_id);

CREATE INDEX IF NOT EXISTS idx_oracle_submissions_methodology
    ON oracle_submissions (methodology);

CREATE INDEX IF NOT EXISTS idx_oracle_submissions_on_chain
    ON oracle_submissions (on_chain_submitted);

CREATE INDEX IF NOT EXISTS idx_oracle_submissions_divergence
    ON oracle_submissions (divergence_type, escalated);

CREATE TABLE IF NOT EXISTS reconciliation_metrics (
    id                  SERIAL PRIMARY KEY,
    run_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submissions_checked INTEGER NOT NULL DEFAULT 0,
    divergences_found   INTEGER NOT NULL DEFAULT 0,
    auto_resolved       INTEGER NOT NULL DEFAULT 0,
    escalated           INTEGER NOT NULL DEFAULT 0,
    duration_seconds    NUMERIC(10, 3)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_metrics_run_at
    ON reconciliation_metrics (run_at);
"""


HEARTBEAT_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS oracle_heartbeats (
    service_name       VARCHAR(50)  PRIMARY KEY,
    instance_id        VARCHAR(200) NOT NULL,
    last_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expected_interval  INTEGER      NOT NULL,
    beat_count         BIGINT       NOT NULL DEFAULT 0,
    last_detail        JSONB,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oracle_heartbeats_last_seen
    ON oracle_heartbeats (last_seen_at);

CREATE TABLE IF NOT EXISTS oracle_liveness_alerts (
    id            SERIAL PRIMARY KEY,
    service_name  VARCHAR(50)  NOT NULL,
    status        VARCHAR(20)  NOT NULL,
    silent_for    INTEGER,
    threshold     INTEGER      NOT NULL,
    message       TEXT         NOT NULL,
    delivered     BOOLEAN      NOT NULL DEFAULT false,
    alerted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oracle_liveness_alerts_service
    ON oracle_liveness_alerts (service_name, alerted_at DESC);
"""


def get_failover_schema_sql() -> str:
    """Return the SQL DDL for the failover state table."""
    return FAILOVER_SCHEMA_SQL


def get_schema_registry_sql() -> str:
    """Return the SQL DDL for the schema registry tables."""
    return SCHEMA_REGISTRY_SQL


def get_heartbeat_schema_sql() -> str:
    """Return the SQL DDL for the liveness heartbeat and alert tables."""
    return HEARTBEAT_SCHEMA_SQL


def get_all_schema_sql() -> str:
    """Return all oracle-related DDL."""
    return "\n".join([FAILOVER_SCHEMA_SQL, SCHEMA_REGISTRY_SQL, HEARTBEAT_SCHEMA_SQL])
