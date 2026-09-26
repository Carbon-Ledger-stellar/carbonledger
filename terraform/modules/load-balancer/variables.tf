variable "identifier" {
    description = "Load balancer identifier"
    type        = string
}

variable "internal" {
    description = "Whether the load balancer is internal"
    type        = bool
    default     = false
}

variable "enable_deletion_protection" {
    description = "Enable deletion protection"
    type        = bool
    default     = true
}

variable "vpc_id" {
    description = "VPC ID"
    type        = string
}

variable "public_subnet_ids" {
    description = "Public subnet IDs"
    type        = list(string)
}

variable "certificate_arn" {
    description = "ACM certificate ARN for HTTPS"
    type        = string
}

variable "tags" {
    description = "Tags to apply to resources"
    type        = map(string)
    default     = {}
}
