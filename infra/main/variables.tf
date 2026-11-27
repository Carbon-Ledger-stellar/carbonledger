variable "aws_region" {
  description = "AWS region"
  default     = "us-east-1"
}

variable "project" {
  description = "Project name prefix for all resources"
  default     = "carbonledger"
}

variable "db_username" {
  description = "PostgreSQL master username"
  sensitive   = true
}

variable "db_password" {
  description = "PostgreSQL master password"
  sensitive   = true
}

# ── Per-workspace sizing ───────────────────────────────────────────────────────
# These are the ONLY allowed differences between staging and production.
# All resource TYPES must be identical in both environments.

variable "app_instance_type" {
  description = "EC2 instance type for the app server"
  default     = "t3.small"
}

variable "db_instance_class" {
  description = "RDS instance class"
  default     = "db.t3.micro"
}

# ── PostgreSQL connection limit — tuned for PgBouncer (#1798) ─────────────────
# PgBouncer default_pool_size=25 + reserve_pool_size=5 + 20 admin/monitoring
# headroom = 50. Setting max_connections to this value reduces shared_buffers
# overhead per connection and prevents accidental direct connections from
# starving the pool. Must be >= pgbouncer default_pool_size + reserve_pool_size
# + a margin for migrations and monitoring.
variable "postgres_max_connections" {
  description = <<-EOT
    PostgreSQL max_connections. Set low enough that PgBouncer's server-side
    pool (default_pool_size + reserve_pool_size) fits with headroom for
    migrations, monitoring, and superuser connections.
    Default: 50 (25 pool + 5 reserve + 20 admin headroom).
    Increase if you raise PgBouncer's default_pool_size or reserve_pool_size.
  EOT
  type    = number
  default = 50

  validation {
    condition     = var.postgres_max_connections >= 25
    error_message = "postgres_max_connections must be at least 25 to accommodate PgBouncer's minimum pool size."
  }
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  default     = "cache.t3.micro"
}

# ── Redis HA topology ──────────────────────────────────────────────────────────

variable "redis_num_cache_clusters" {
  description = <<-EOT
    Number of cache clusters (nodes) in the replication group.
    Overridden by enable_redis_sentinel: when true, always 3 nodes.
  EOT
  default     = 2

}

variable "enable_redis_sentinel" {
  description = <<-EOT
    When true, provisions a 3-node Redis Sentinel HA cluster (1 primary + 2 replicas)
    with automatic failover and Multi-AZ. Default: true.

    Environment parity policy: MUST be true in both staging and production.
    Setting this to false is only permitted for ephemeral feature-branch environments.
  EOT
  type    = bool
  default = true
}

variable "redis_transit_encryption" {
  description = "Enable TLS in-transit encryption for Redis. Recommended true in production."
  type        = bool
  default     = false
}

# ── CloudWatch ────────────────────────────────────────────────────────────────

variable "cloudwatch_log_retention_days" {
  description = "CloudWatch Logs retention in days for application log groups"
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.cloudwatch_log_retention_days)
    error_message = "cloudwatch_log_retention_days must be one of the allowed CloudWatch retention values."
  }
}

variable "cloudwatch_alarm_email" {
  description = "Email address for CloudWatch alarm SNS notifications. Leave empty to disable email alerts."
  type        = string
  default     = ""
}

variable "enable_cloudwatch_alarms" {
  description = "Create CloudWatch metric alarms (CPU, memory, error rate). Default: true."
  type        = bool
  default     = true
}

