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
