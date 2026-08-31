variable "identifier" {
    description = "Redis cluster identifier"
    type        = string
}

variable "environment" {
    description = "Environment name"
    type        = string
}

variable "engine_version" {
    description = "Redis engine version"
    type        = string
    default     = "7.0"
}

variable "node_type" {
    description = "Redis node type"
    type        = string
    default     = "cache.t4g.micro"
}

variable "num_cache_clusters" {
    description = "Number of cache clusters"
    type        = number
    default     = 1
}

variable "automatic_failover_enabled" {
    description = "Enable automatic failover"
    type        = bool
    default     = false
}

variable "multi_az_enabled" {
    description = "Enable Multi-AZ"
    type        = bool
    default     = false
}

variable "snapshot_retention_limit" {
    description = "Snapshot retention limit in days"
    type        = number
    default     = 7
}

variable "snapshot_window" {
    description = "Snapshot window"
    type        = string
    default     = "04:00-06:00"
}

variable "maintenance_window" {
    description = "Maintenance window"
    type        = string
    default     = "sun:05:00-sun:07:00"
}

variable "vpc_id" {
    description = "VPC ID"
    type        = string
}

variable "subnet_ids" {
    description = "Subnet IDs"
    type        = list(string)
}

variable "ingress_security_group_id" {
    description = "Security group ID for ingress"
    type        = string
}

variable "tags" {
    description = "Tags to apply to resources"
    type        = map(string)
    default     = {}
}
