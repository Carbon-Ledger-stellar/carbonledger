# terraform workspace select production
# terraform apply -var-file=production.tfvars -var="db_username=carbonledger" -var="db_password=<SECRET>"
#
# Environment parity policy:
#   Production uses the same resource types as staging.
#   Only instance/node sizes and retention periods differ.

# ── Compute ───────────────────────────────────────────────────────────────────
app_instance_type = "t3.medium"     # staging: t3.small

# ── Database ──────────────────────────────────────────────────────────────────
db_instance_class = "db.t3.small"   # staging: db.t3.micro

# ── Redis ─────────────────────────────────────────────────────────────────────
redis_node_type           = "cache.t3.small"   # staging: cache.t3.micro
enable_redis_sentinel     = true               # 3-node HA — same as staging
redis_transit_encryption  = true               # staging: false

# ── CloudWatch ────────────────────────────────────────────────────────────────
enable_cloudwatch_alarms        = true    # same as staging
cloudwatch_log_retention_days   = 90      # staging: 30
cloudwatch_alarm_email          = ""      # set to ops-alerts@carbonledger.io
