variable "aws_region" {
    description = "AWS region"
    type        = string
    default     = "us-east-1"
}

variable "db_username" {
    description = "Database username"
    type        = string
    sensitive   = true
}

variable "db_password" {
    description = "Database password"
    type        = string
    sensitive   = true
}

variable "certificate_arn" {
    description = "ACM certificate ARN"
    type        = string
}

variable "environment" {
    description = "Environment name"
    type        = string
    default     = "production"
}
