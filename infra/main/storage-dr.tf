############################################
# Cross-Region Disaster Recovery — S3 Replication
#
# Issue #1065: Disaster Recovery Plan requires backups in 2+ regions.
#
# This file provisions:
#   - A DR S3 bucket in var.dr_region (default: us-west-2) that receives
#     a replica of every object written to the primary db_backups bucket
#     in the primary region (us-east-1).
#   - An IAM replication role with the minimal permissions required by S3.
#   - Cross-region replication configuration on the primary backup bucket.
#
# Pre-requisites:
#   - Versioning must be enabled on BOTH the source and destination buckets.
#     (Already enabled on the source in storage.tf.)
#   - The dr_region must differ from aws_region.
#
# RPO implication:
#   Objects are replicated asynchronously (typically within seconds to minutes).
#   In the worst case (large backup + regional degradation) the DR bucket may
#   lag by up to 15 minutes — this is within the RPO < 15 min target documented
#   in docs/disaster-recovery-plan.md.
############################################

variable "dr_region" {
  description = <<-EOT
    AWS region for the cross-region DR S3 bucket.
    Must differ from var.aws_region.
    Default: us-west-2 (paired with us-east-1 primary).
  EOT
  type    = string
  default = "us-west-2"
}

# ── DR bucket provider ────────────────────────────────────────────────────────
# A separate provider alias is required because S3 bucket resources are
# regional. The DR bucket lives in var.dr_region, everything else in
# var.aws_region.

provider "aws" {
  alias  = "dr"
  region = var.dr_region
}

# ── DR S3 bucket ──────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "db_backups_dr" {
  provider = aws.dr
  bucket   = "${var.project}-db-backups-dr-${terraform.workspace}"
  tags     = { Name = "${local.name}-db-backups-dr", Purpose = "disaster-recovery" }
}

resource "aws_s3_bucket_versioning" "db_backups_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.db_backups_dr.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "db_backups_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.db_backups_dr.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "db_backups_dr" {
  provider                = aws.dr
  bucket                  = aws_s3_bucket.db_backups_dr.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "db_backups_dr" {
  provider = aws.dr
  bucket   = aws_s3_bucket.db_backups_dr.id

  rule {
    id     = "dr-expire-after-30-days"
    status = "Enabled"

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# ── IAM role for S3 cross-region replication ──────────────────────────────────

data "aws_iam_policy_document" "s3_replication_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["s3.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "s3_replication" {
  name               = "${local.name}-s3-replication"
  assume_role_policy = data.aws_iam_policy_document.s3_replication_assume.json
  tags               = { Name = "${local.name}-s3-replication-role" }
}

data "aws_iam_policy_document" "s3_replication_permissions" {
  statement {
    sid = "SourceBucketAccess"
    actions = [
      "s3:GetReplicationConfiguration",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.db_backups.arn]
  }

  statement {
    sid = "SourceObjectAccess"
    actions = [
      "s3:GetObjectVersionForReplication",
      "s3:GetObjectVersionAcl",
      "s3:GetObjectVersionTagging",
    ]
    resources = ["${aws_s3_bucket.db_backups.arn}/*"]
  }

  statement {
    sid = "DestinationBucketWrite"
    actions = [
      "s3:ReplicateObject",
      "s3:ReplicateDelete",
      "s3:ReplicateTags",
      "s3:GetObjectVersionTagging",
    ]
    resources = ["${aws_s3_bucket.db_backups_dr.arn}/*"]
  }
}

resource "aws_iam_role_policy" "s3_replication" {
  name   = "${local.name}-s3-replication-policy"
  role   = aws_iam_role.s3_replication.id
  policy = data.aws_iam_policy_document.s3_replication_permissions.json
}

# ── Cross-region replication configuration on the primary backup bucket ───────

resource "aws_s3_bucket_replication_configuration" "db_backups_to_dr" {
  # Depends on versioning being enabled on the source bucket (storage.tf)
  depends_on = [aws_s3_bucket_versioning.db_backups]

  bucket = aws_s3_bucket.db_backups.id
  role   = aws_iam_role.s3_replication.arn

  rule {
    id     = "replicate-all-to-dr"
    status = "Enabled"

    # Replicate all objects (no prefix filter)
    filter {
      prefix = ""
    }

    destination {
      bucket        = aws_s3_bucket.db_backups_dr.arn
      storage_class = "STANDARD_IA" # Cheaper; DR restores are infrequent

      # Replication metrics and replication time control (RTC) ensure
      # 99.99% of objects are replicated within 15 minutes, matching RPO.
      replication_time {
        status = "Enabled"
        time {
          minutes = 15
        }
      }

      metrics {
        status = "Enabled"
        event_threshold {
          minutes = 15
        }
      }
    }

    delete_marker_replication {
      status = "Enabled"
    }
  }
}

# ── CloudWatch alarm: replication lag ────────────────────────────────────────
# Fires if S3 Replication Time Control reports objects pending replication
# for more than 15 minutes, which would breach the RPO target.

resource "aws_cloudwatch_metric_alarm" "s3_replication_lag" {
  count               = var.enable_cloudwatch_alarms ? 1 : 0
  alarm_name          = "${local.name}-s3-replication-lag"
  alarm_description   = "DB backup replication to DR region is lagging > 15 minutes. RPO may be breached."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ReplicationLatency"
  namespace           = "AWS/S3"
  period              = 300
  statistic           = "Maximum"
  threshold           = 900 # 15 minutes in seconds
  treat_missing_data  = "notBreaching"

  dimensions = {
    SourceBucket      = aws_s3_bucket.db_backups.id
    DestinationBucket = aws_s3_bucket.db_backups_dr.id
    RuleId            = "replicate-all-to-dr"
  }

  alarm_actions = var.enable_cloudwatch_alarms ? [aws_sns_topic.alarms[0].arn] : []

  tags = { Name = "${local.name}-s3-replication-lag" }
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "db_backups_dr_bucket" {
  description = "Name of the cross-region DR S3 bucket for database backups (us-west-2)"
  value       = aws_s3_bucket.db_backups_dr.bucket
}

output "db_backups_dr_region" {
  description = "AWS region of the DR S3 bucket"
  value       = var.dr_region
}
