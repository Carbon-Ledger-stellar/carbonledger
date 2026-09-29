# Pause Feature Infrastructure Resources (#1310)

resource "aws_s3_bucket" "pause_audit_backups" {
  bucket        = "carbonledger-${var.environment}-pause-audit-backups"
  force_destroy = false

  tags = {
    Environment = var.environment
    Service     = "pause-audit-backup"
  }
}

resource "aws_s3_bucket_versioning" "pause_audit_versioning" {
  bucket = aws_s3_bucket.pause_audit_backups.id
  versioning_configuration {
    status = "Enabled"
  }
}
