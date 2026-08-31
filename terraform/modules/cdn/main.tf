# S3 bucket for frontend hosting
resource "aws_s3_bucket" "frontend" {
    bucket = "${var.identifier}-frontend-${var.environment}"
    tags   = var.tags
}

resource "aws_s3_bucket_website_configuration" "frontend" {
    bucket = aws_s3_bucket.frontend.id

    index_document {
        suffix = "index.html"
    }

    error_document {
        key = "index.html"
    }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
    bucket = aws_s3_bucket.frontend.id

    block_public_acls       = true
    block_public_policy     = true
    ignore_public_acls      = true
    restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "frontend" {
    bucket = aws_s3_bucket.frontend.id
    policy = data.aws_iam_policy_document.frontend.json
}

data "aws_iam_policy_document" "frontend" {
    statement {
        actions   = ["s3:GetObject"]
        resources = ["${aws_s3_bucket.frontend.arn}/*"]

        principals {
            type        = "Service"
            identifiers = ["cloudfront.amazonaws.com"]
        }

        condition {
            test     = "StringEquals"
            variable = "AWS:SourceArn"
            values   = [aws_cloudfront_distribution.frontend.arn]
        }
    }
}

# CloudFront CDN
resource "aws_cloudfront_distribution" "frontend" {
    enabled             = true
    is_ipv6_enabled     = true
    default_root_object = "index.html"

    origin {
        domain_name = aws_s3_bucket_website_configuration.frontend.website_endpoint
        origin_id   = "s3-origin"

        custom_origin_config {
            http_port              = 80
            https_port             = 443
            origin_protocol_policy = "http-only"
            origin_ssl_protocols   = ["TLSv1.2"]
        }
    }

    default_cache_behavior {
        target_origin_id = "s3-origin"

        viewer_protocol_policy = "redirect-to-https"
        compress               = true

        allowed_methods = ["GET", "HEAD", "OPTIONS"]
        cached_methods  = ["GET", "HEAD", "OPTIONS"]

        forwarded_values {
            query_string = false

            cookies {
                forward = "none"
            }
        }

        min_ttl     = 0
        default_ttl = 86400
        max_ttl     = 31536000
    }

    custom_error_response {
        error_code         = 404
        response_code      = 200
        response_page_path = "/index.html"
    }

    restrictions {
        geo_restriction {
            restriction_type = "none"
        }
    }

    viewer_certificate {
        cloudfront_default_certificate = true
        ssl_support_method            = "sni-only"
        minimum_protocol_version      = "TLSv1.2_2021"
    }

    tags = var.tags

    aliases = var.aliases
}
