# terraform workspace select staging
# terraform apply -var-file=staging.tfvars -var="db_username=carbonledger" -var="db_password=<SECRET>"
#
# Environment parity policy:
#   Staging uses the SAME resource types as production.
#   Only instance/node sizes differ. See infra/README.md for the full policy.

# ── Compute ───────────────────────────────────────────────────────────────────
app_instance_type = "t3.small"      # prod: t3.medium

# ── Database ──────────────────────────────────────────────────────────────────
db_instance_class = "db.t3.micro"   # prod: db.t3.small

# PgBouncer pool: default_pool_size=25 + reserve=5 + admin headroom=20 = 50.
# Matches the default in variables.tf — explicit here for visibility.
postgres_max_connections = 50       # prod: 50 (same, pooler-tuned)

# ── Redis ─────────────────────────────────────────────────────────────────────
redis_node_type           = "cache.t3.micro"   # prod: cache.t3.small
enable_redis_sentinel     = true               # 3-node HA — same as production
redis_transit_encryption  = false              # prod: true

# ── CloudWatch ────────────────────────────────────────────────────────────────
enable_cloudwatch_alarms        = true    # same as production
cloudwatch_log_retention_days   = 30      # prod: 90
cloudwatch_alarm_email          = ""      # set to ops email to receive alerts
