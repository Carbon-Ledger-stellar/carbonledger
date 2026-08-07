"""
Database schema definitions for oracle failover and schema versioning.

Provides SQL DDL for the tables required by the disaster recovery
and methodology schema versioning features.
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


AUDIT_CHAIN_SQL = """
CREATE TABLE IF NOT EXISTS oracle_audit_chain (
    id             BIGSERIAL    PRIMARY KEY,
    sequence       BIGINT       NOT NULL UNIQUE,
    recorded_at    TIMESTAMPTZ  NOT NULL,
    service        VARCHAR(50)  NOT NULL,
    contract_id    VARCHAR(100),
    function_name  VARCHAR(100) NOT NULL,
    payload        JSONB        NOT NULL,
    payload_hash   CHAR(64)     NOT NULL,
    tx_hash        VARCHAR(200),
    status         VARCHAR(20)  NOT NULL,
    previous_hash  CHAR(64),
    entry_hash     CHAR(64)     NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_oracle_audit_chain_sequence
    ON oracle_audit_chain (sequence);

CREATE INDEX IF NOT EXISTS idx_oracle_audit_chain_recorded_at
    ON oracle_audit_chain (recorded_at);

CREATE INDEX IF NOT EXISTS idx_oracle_audit_chain_function
    ON oracle_audit_chain (function_name);

CREATE INDEX IF NOT EXISTS idx_oracle_audit_chain_previous_hash
    ON oracle_audit_chain (previous_hash);
"""


def get_failover_schema_sql() -> str:
    """Return the SQL DDL for the failover state table."""
    return FAILOVER_SCHEMA_SQL


def get_schema_registry_sql() -> str:
    """Return the SQL DDL for the schema registry tables."""
    return SCHEMA_REGISTRY_SQL


def get_audit_chain_sql() -> str:
    """Return the SQL DDL for the tamper-evident submission audit chain."""
    return AUDIT_CHAIN_SQL


def get_all_schema_sql() -> str:
    """Return all oracle-related DDL."""
    return "\n".join([FAILOVER_SCHEMA_SQL, SCHEMA_REGISTRY_SQL, AUDIT_CHAIN_SQL])
