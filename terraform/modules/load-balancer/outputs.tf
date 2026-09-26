output "arn" {
    description = "ARN of the load balancer"
    value       = aws_lb.api.arn
}

output "dns_name" {
    description = "DNS name of the load balancer"
    value       = aws_lb.api.dns_name
}

output "target_group_arn" {
    description = "ARN of the target group"
    value       = aws_lb_target_group.api.arn
}

output "security_group_id" {
    description = "Security group ID"
    value       = aws_security_group.api.id
}
