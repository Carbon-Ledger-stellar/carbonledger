output "bucket_id" {
    description = "S3 bucket ID"
    value       = aws_s3_bucket.frontend.id
}

output "bucket_arn" {
    description = "S3 bucket ARN"
    value       = aws_s3_bucket.frontend.arn
}

output "cloudfront_domain" {
    description = "CloudFront distribution domain name"
    value       = aws_cloudfront_distribution.frontend.domain_name
}

output "cloudfront_arn" {
    description = "CloudFront distribution ARN"
    value       = aws_cloudfront_distribution.frontend.arn
}
