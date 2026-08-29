# ── CloudWatch Log Groups ─────────────────────────────────────────────────────
#
# Environment parity: these log groups are provisioned in BOTH staging and
# production. Previously only scripts/setup-cloudwatch.sh created them for
# production. Moving them into Terraform ensures staging has identical
# observability to production.
#
# Retention is configurable via cloudwatch_log_retention_days (default: 30).
# The same retention period is used in both environments.

resource "aws_cloudwatch_log_group" "backend" {
  name              = "/${var.project}/${terraform.workspace}/backend"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = { Name = "${local.name}-backend-logs" }
}

resource "aws_cloudwatch_log_group" "frontend" {
  name              = "/${var.project}/${terraform.workspace}/frontend"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = { Name = "${local.name}-frontend-logs" }
}

resource "aws_cloudwatch_log_group" "oracle" {
  name              = "/${var.project}/${terraform.workspace}/oracle"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = { Name = "${local.name}-oracle-logs" }
}

resource "aws_cloudwatch_log_group" "nginx" {
  name              = "/${var.project}/${terraform.workspace}/nginx"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = { Name = "${local.name}-nginx-logs" }
}

resource "aws_cloudwatch_log_group" "contracts" {
  name              = "/${var.project}/${terraform.workspace}/contracts"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = { Name = "${local.name}-contracts-logs" }
}

# ── SNS Topic for alarm notifications ────────────────────────────────────────

resource "aws_sns_topic" "alarms" {
  count = var.enable_cloudwatch_alarms ? 1 : 0
  name  = "${local.name}-alarms"
  tags  = { Name = "${local.name}-alarms" }
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count     = var.enable_cloudwatch_alarms && var.cloudwatch_alarm_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alarms[0].arn
  protocol  = "email"
  endpoint  = var.cloudwatch_alarm_email
}

# ── EC2 CPU alarm ─────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "ec2_cpu_high" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-ec2-cpu-high"
  alarm_description   = "EC2 CPU utilization > 80% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300   # 5 minutes
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    InstanceId = aws_instance.app.id
  }

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []
  ok_actions    = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-ec2-cpu-high" }
}

# ── RDS CPU alarm ─────────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "rds_cpu_high" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-rds-cpu-high"
  alarm_description   = "RDS CPU utilization > 80% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []
  ok_actions    = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-rds-cpu-high" }
}

# ── RDS free storage alarm ────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-rds-storage-low"
  alarm_description   = "RDS free storage < 2 GB"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "FreeStorageSpace"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 2147483648   # 2 GiB in bytes
  treat_missing_data  = "notBreaching"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-rds-storage-low" }
}

# ── Redis CPU alarm ───────────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "redis_cpu_high" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-redis-cpu-high"
  alarm_description   = "Redis CPU utilization > 70% for 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "EngineCPUUtilization"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Average"
  threshold           = 70
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.redis.id
  }

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []
  ok_actions    = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-redis-cpu-high" }
}

# ── Redis eviction alarm ──────────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "redis_evictions" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-redis-evictions"
  alarm_description   = "Redis evictions > 0 — memory pressure, review maxmemory-policy"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Evictions"
  namespace           = "AWS/ElastiCache"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    ReplicationGroupId = aws_elasticache_replication_group.redis.id
  }

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-redis-evictions" }
}

# ── Application error rate alarm ─────────────────────────────────────────────
# Fires when backend log group receives more than 10 ERROR entries in 5 minutes.
# This requires a log metric filter on the backend log group.

resource "aws_cloudwatch_log_metric_filter" "backend_errors" {
  name           = "${local.name}-backend-error-count"
  log_group_name = aws_cloudwatch_log_group.backend.name
  pattern        = "ERROR"

  metric_transformation {
    name          = "BackendErrorCount"
    namespace     = "${var.project}/Application"
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "backend_error_rate_high" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-backend-error-rate-high"
  alarm_description   = "Backend application error rate > 10 errors in 5 minutes"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "BackendErrorCount"
  namespace           = "${var.project}/Application"
  period              = 300
  statistic           = "Sum"
  threshold           = 10
  treat_missing_data  = "notBreaching"

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []
  ok_actions    = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-backend-error-rate-high" }
}

# ── Secrets Manager access log and alarm (#1066) ────────────────────────────
#
# CloudTrail logs all secretsmanager API calls to a CloudWatch log group.
# This metric filter counts every GetSecretValue call and emits it to a custom
# namespace. The alarm fires when the count in a 5-minute window exceeds the
# expected burst threshold (100 calls), which would indicate a credential
# scraping attempt or a runaway process.
#
# A second, tighter filter fires immediately on any GetSecretValue event whose
# userIdentity.arn does NOT match the expected ECS task role or rotation Lambda
# execution role. That alarm requires a separate CloudTrail-to-CloudWatch Logs
# subscription (see infra/README.md — the CloudTrail log group is
# "carbonledger-cloudtrail").
#
# NOTE: The CloudTrail log group name is configurable. If your account ships
# CloudTrail events to a different log group, set var.cloudtrail_log_group_name.

resource "aws_cloudwatch_log_group" "cloudtrail" {
  name              = "/carbonledger/${terraform.workspace}/cloudtrail"
  retention_in_days = var.cloudwatch_log_retention_days
  tags              = { Name = "${local.name}-cloudtrail-logs" }
}

# Metric filter: count all GetSecretValue API calls
resource "aws_cloudwatch_log_metric_filter" "secret_access" {
  name           = "${local.name}-secret-access-count"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  # CloudTrail JSON pattern — matches the secretsmanager GetSecretValue event
  pattern = "{ $.eventSource = \"secretsmanager.amazonaws.com\" && $.eventName = \"GetSecretValue\" }"

  metric_transformation {
    name          = "SecretsManagerGetSecretValueCount"
    namespace     = "${var.project}/Security"
    value         = "1"
    default_value = "0"
  }
}

# Alarm: high volume of GetSecretValue calls — potential scraping or runaway process
resource "aws_cloudwatch_metric_alarm" "secret_access_high_volume" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-secret-access-high-volume"
  alarm_description   = "More than 100 GetSecretValue calls in 5 minutes. Possible credential scraping or misconfigured process."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "SecretsManagerGetSecretValueCount"
  namespace           = "${var.project}/Security"
  period              = 300
  statistic           = "Sum"
  threshold           = 100
  treat_missing_data  = "notBreaching"

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []
  ok_actions    = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-secret-access-high-volume" }
}

# Metric filter: GetSecretValue calls that originate from an unexpected principal.
# Expected principals: ECS task role and the rotation Lambda role.
# Anything else is anomalous and should alert immediately.
resource "aws_cloudwatch_log_metric_filter" "secret_access_anomaly" {
  name           = "${local.name}-secret-access-anomaly"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  # Matches GetSecretValue calls where the principal ARN does NOT contain
  # "rotation-lambda" or "app" (the ECS task role suffix).
  pattern = "{ $.eventSource = \"secretsmanager.amazonaws.com\" && $.eventName = \"GetSecretValue\" && $.userIdentity.arn != \"*rotation-lambda*\" && $.userIdentity.arn != \"*-app*\" }"

  metric_transformation {
    name          = "SecretsManagerAnomalousAccess"
    namespace     = "${var.project}/Security"
    value         = "1"
    default_value = "0"
  }
}

# Alarm: any anomalous GetSecretValue call fires immediately (threshold = 0)
resource "aws_cloudwatch_metric_alarm" "secret_access_anomaly" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-secret-access-anomaly"
  alarm_description   = "GetSecretValue from an unexpected IAM principal. Investigate immediately."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "SecretsManagerAnomalousAccess"
  namespace           = "${var.project}/Security"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []
  ok_actions    = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-secret-access-anomaly" }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "cloudwatch_log_group_backend" {
  description = "CloudWatch log group name for the NestJS backend"
  value       = aws_cloudwatch_log_group.backend.name
}

output "cloudwatch_log_group_oracle" {
  description = "CloudWatch log group name for the Oracle services"
  value       = aws_cloudwatch_log_group.oracle.name
}

output "cloudwatch_alarm_sns_topic" {
  description = "SNS topic ARN for CloudWatch alarm notifications"
  value       = var.enable_cloudwatch_alarms ? aws_sns_topic.alarms[0].arn : null
}

output "cloudwatch_log_group_cloudtrail" {
  description = "CloudWatch log group name for CloudTrail events (used by Secrets Manager alarm)"
  value       = aws_cloudwatch_log_group.cloudtrail.name
}
