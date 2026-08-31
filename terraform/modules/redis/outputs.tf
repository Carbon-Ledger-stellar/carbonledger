output "arn" {
    description = "ARN of the Redis cluster"
    value       = aws_elasticache_replication_group.redis.arn
}

output "address" {
    description = "Redis cluster address"
    value       = aws_elasticache_replication_group.redis.primary_endpoint_address
}

output "port" {
    description = "Redis cluster port"
    value       = aws_elasticache_replication_group.redis.port
}

output "security_group_id" {
    description = "Security group ID"
    value       = aws_security_group.redis.id
}
