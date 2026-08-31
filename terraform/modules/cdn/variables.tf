variable "identifier" {
    description = "CDN identifier"
    type        = string
}

variable "environment" {
    description = "Environment name"
    type        = string
}

variable "aliases" {
    description = "Domain aliases for CloudFront"
    type        = list(string)
    default     = []
}

variable "tags" {
    description = "Tags to apply to resources"
    type        = map(string)
    default     = {}
}
