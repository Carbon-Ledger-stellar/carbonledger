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

# Per-workspace sizing — override in staging.tfvars / production.tfvars
variable "app_instance_type" {
  description = "EC2 instance type for the app server"
  default     = "t3.small"
}

variable "db_instance_class" {
  description = "RDS instance class"
  default     = "db.t3.micro"
}

variable "redis_node_type" {
  description = "ElastiCache node type"
  default     = "cache.t3.micro"
}

variable "redis_num_cache_clusters" {
  description = "Number of cache clusters (nodes) in the replication group"
  default     = 2
}
