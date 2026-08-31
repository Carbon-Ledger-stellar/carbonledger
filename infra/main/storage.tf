# ── S3 bucket for certificates and uploads ────────────────────────────────────

resource "aws_s3_bucket" "assets" {
  bucket = "${var.project}-assets-${terraform.workspace}"
  tags   = { Name = "${local.name}-assets" }
}

resource "aws_s3_bucket_versioning" "assets" {
  bucket = aws_s3_bucket.assets.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "assets" {
  bucket = aws_s3_bucket.assets.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "assets" {
  bucket                  = aws_s3_bucket.assets.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# IAM policy allowing the app EC2 role to read/write the assets bucket
resource "aws_iam_role_policy" "app_s3" {
  name = "${local.name}-app-s3"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.assets.arn,
        "${aws_s3_bucket.assets.arn}/*"
      ]
    }]
  })
}

output "assets_bucket" { value = aws_s3_bucket.assets.bucket }

# ── S3 bucket for PostgreSQL backups ─────────────────────────────────────────

resource "aws_s3_bucket" "db_backups" {
  bucket = "${var.project}-db-backups-${terraform.workspace}"
  tags   = { Name = "${local.name}-db-backups" }
}

resource "aws_s3_bucket_versioning" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "db_backups" {
  bucket                  = aws_s3_bucket.db_backups.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "db_backups" {
  bucket = aws_s3_bucket.db_backups.id

  rule {
    id     = "expire-after-30-days"
    status = "Enabled"

    expiration {
      days = 30
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

output "db_backups_bucket" { value = aws_s3_bucket.db_backups.bucket }

# ── S3 bucket for IPFS backup ─────────────────────────────────────────────────
#
# Environment parity: provisioned in BOTH staging and production.
# Stores CID-addressed content pinned to Pinata as a secondary backup.
# Lifecycle policy: transition to Glacier after 90 days, expire after 365 days.
# This matches production behaviour so staging can validate backup restoration.
#
# See docs/IPFS_CONTENT_INTEGRITY.md for the backup strategy.

resource "aws_s3_bucket" "ipfs_backup" {
  bucket = "${var.project}-ipfs-backup-${terraform.workspace}"
  tags   = { Name = "${local.name}-ipfs-backup" }
}

resource "aws_s3_bucket_versioning" "ipfs_backup" {
  bucket = aws_s3_bucket.ipfs_backup.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "ipfs_backup" {
  bucket = aws_s3_bucket.ipfs_backup.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "ipfs_backup" {
  bucket                  = aws_s3_bucket.ipfs_backup.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Lifecycle policy: Glacier transition + expiry
resource "aws_s3_bucket_lifecycle_configuration" "ipfs_backup" {
  bucket = aws_s3_bucket.ipfs_backup.id

  rule {
    id     = "ipfs-tiered-storage"
    status = "Enabled"

    # Transition to Glacier Instant Retrieval after 90 days
    transition {
      days          = 90
      storage_class = "GLACIER_IR"
    }

    # Expire objects after 1 year (content is still available via IPFS pinning)
    expiration {
      days = 365
    }

    # Clean up previous versions after 30 days
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# IAM policy: app role can read/write IPFS backup bucket
resource "aws_iam_role_policy" "app_s3_ipfs" {
  name = "${local.name}-app-s3-ipfs"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.ipfs_backup.arn,
        "${aws_s3_bucket.ipfs_backup.arn}/*"
      ]
    }]
  })
}

output "ipfs_backup_bucket" {
  description = "S3 bucket for IPFS content backup (both staging and production)"
  value       = aws_s3_bucket.ipfs_backup.bucket
}
