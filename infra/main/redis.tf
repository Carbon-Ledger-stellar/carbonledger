# ── Security Group ────────────────────────────────────────────────────────────

resource "aws_security_group" "redis" {
  name   = "${local.name}-redis-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  # Sentinel port — required for Sentinel topology (nodes discover each other)
  ingress {
    from_port       = 26379
    to_port         = 26379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
    description     = "Redis Sentinel port"
  }

  tags = { Name = "${local.name}-redis-sg" }
}

# ── Subnet group ──────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

# ── ElastiCache Redis — Replication Group ─────────────────────────────────────
#
# Environment parity policy:
#   - Both staging and production use a replication group (HA).
#   - enable_redis_sentinel = true  → 3-node cluster (1 primary + 2 replicas)
#     with automatic failover and Multi-AZ.  Default: true.
#   - enable_redis_sentinel = false → 2-node cluster (minimal HA).
#     Not recommended; only for cost-constrained non-production environments.
#
# Instance sizes differ between environments (see staging.tfvars / production.tfvars)
# but the topology (replication group, automatic failover) is identical.
#
# Why 3 nodes for Sentinel HA?
#   Redis Sentinel requires an odd number of sentinels (≥3) to achieve quorum
#   for failover decisions.  ElastiCache models Sentinel quorum via the number
#   of cache clusters: with 3 nodes a majority of 2 out of 3 is always reachable
#   even if one AZ goes down.

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id       = "${local.name}-redis"
  description                = "Redis HA replication group for ${local.name} (${terraform.workspace})"
  node_type                  = var.redis_node_type
  parameter_group_name       = "default.redis7"
  port                       = 6379
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]

  # HA topology — same in both environments; only the instance size differs.
  num_cache_clusters         = var.enable_redis_sentinel ? 3 : 2
  automatic_failover_enabled = true
  multi_az_enabled           = true

  # At-rest encryption — required in both environments.
  at_rest_encryption_enabled = true

  # In-transit encryption — enable in production; optionally in staging.
  transit_encryption_enabled = var.redis_transit_encryption

  tags = {
    Name        = "${local.name}-redis"
    Environment = terraform.workspace
    HAMode      = var.enable_redis_sentinel ? "sentinel-3-node" : "replication-2-node"
  }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "redis_primary_endpoint" {
  description = "Redis primary endpoint for write operations"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "Redis reader endpoint for read operations (load balanced across replicas)"
  value       = aws_elasticache_replication_group.redis.reader_endpoint_address
}

output "redis_num_nodes" {
  description = "Number of cache nodes in the replication group"
  value       = aws_elasticache_replication_group.redis.num_cache_clusters
}
