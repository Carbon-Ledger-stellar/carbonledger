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

  tags = { Name = "${local.name}-redis-sg" }
}

# ── Subnet group ──────────────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "main" {
  name       = "${local.name}-redis-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

# ── ElastiCache Redis (Replication Group for HA) ──────────────────────────────

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id          = "${local.name}-redis"
  description                   = "Redis replication group for ${local.name}"
  node_type                     = var.redis_node_type
  num_cache_clusters            = var.redis_num_cache_clusters
  parameter_group_name          = "default.redis7"
  port                          = 6379
  subnet_group_name             = aws_elasticache_subnet_group.main.name
  security_group_ids            = [aws_security_group.redis.id]
  automatic_failover_enabled    = true
  multi_az_enabled              = true

  tags = { Name = "${local.name}-redis" }
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.redis.primary_endpoint_address
}
