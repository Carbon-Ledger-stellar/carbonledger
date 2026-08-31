variable "identifier" {
    description = "Database identifier"
    type        = string
}

variable "engine_version" {
    description = "PostgreSQL engine version"
    type        = string
    default     = "15.4"
}

variable "instance_class" {
    description = "RDS instance class"
    type        = string
    default     = "db.t4g.medium"
}

variable "allocated_storage" {
    description = "Allocated storage in GB"
    type        = number
    default     = 100
}

variable "max_allocated_storage" {
    description = "Maximum storage in GB (auto-scaling)"
    type        = number
    default     = 1000
}

variable "db_name" {
    description = "Database name"
    type        = string
}

variable "username" {
    description = "Database username"
    type        = string
}

variable "password" {
    description = "Database password"
    type        = string
    sensitive   = true
}

variable "backup_retention_period" {
    description = "Backup retention period in days"
    type        = number
    default     = 30
}

variable "backup_window" {
    description = "Backup window"
    type        = string
    default     = "03:00-04:00"
}

variable "maintenance_window" {
    description = "Maintenance window"
    type        = string
    default     = "sun:04:00-sun:05:00"
}

variable "deletion_protection" {
    description = "Enable deletion protection"
    type        = bool
    default     = true
}

variable "skip_final_snapshot" {
    description = "Skip final snapshot on deletion"
    type        = bool
    default     = false
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

variable "replicate_to_region" {
    description = "Region to replicate backups to"
    type        = string
    default     = ""
}

variable "kms_key_id" {
    description = "KMS key ID for encryption"
    type        = string
    default     = null
}

variable "tags" {
    description = "Tags to apply to resources"
    type        = map(string)
    default     = {}
}
