output "arn" {
    description = "ARN of the database"
    value       = aws_db_instance.postgres.arn
}

output "address" {
    description = "Database address"
    value       = aws_db_instance.postgres.address
}

output "port" {
    description = "Database port"
    value       = aws_db_instance.postgres.port
}

output "security_group_id" {
    description = "Security group ID"
    value       = aws_security_group.postgres.id
}
