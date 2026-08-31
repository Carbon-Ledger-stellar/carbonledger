resource "aws_elasticache_replication_group" "redis" {
    replication_group_id       = var.identifier
    description                = "Redis cache for ${var.environment}"
    engine                     = "redis"
    engine_version             = var.engine_version
    node_type                  = var.node_type
    num_cache_clusters         = var.num_cache_clusters
    port                       = 6379
    parameter_group_name       = aws_elasticache_parameter_group.redis.name
    subnet_group_name          = aws_elasticache_subnet_group.redis.name
    security_group_ids         = [aws_security_group.redis.id]

    automatic_failover_enabled = var.automatic_failover_enabled
    multi_az_enabled          = var.multi_az_enabled

    snapshot_retention_limit   = var.snapshot_retention_limit
    snapshot_window           = var.snapshot_window
    maintenance_window         = var.maintenance_window

    at_rest_encryption_enabled = true
    transit_encryption_enabled = true

    tags = var.tags
}

resource "aws_elasticache_parameter_group" "redis" {
    name        = "${var.identifier}-params"
    family      = "redis7"
    description = "Redis parameter group"

    parameter {
        name  = "maxmemory-policy"
        value = "allkeys-lru"
    }

    tags = var.tags
}

resource "aws_elasticache_subnet_group" "redis" {
    name       = "${var.identifier}-subnet-group"
    subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
    name        = "${var.identifier}-sg"
    description = "Security group for Redis cache"
    vpc_id      = var.vpc_id

    ingress {
        from_port       = 6379
        to_port         = 6379
        protocol        = "tcp"
        security_groups = [var.ingress_security_group_id]
    }

    egress {
        from_port   = 0
        to_port     = 0
        protocol    = "-1"
        cidr_blocks = ["0.0.0.0/0"]
    }

    tags = var.tags
}
