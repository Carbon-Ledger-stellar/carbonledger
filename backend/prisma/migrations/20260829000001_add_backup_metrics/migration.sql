-- Migration: add backup_metrics table for tracking backup and restore operations
-- Stores metrics for automated backups and monthly restore tests
-- Enables monitoring of backup size, duration, restore time, and SLA compliance

CREATE TABLE "backup_metrics" (
  id SERIAL PRIMARY KEY,
  backup_key TEXT NOT NULL UNIQUE,
  backup_size_bytes BIGINT NOT NULL,
  dump_time_seconds INTEGER,
  upload_time_seconds INTEGER,
  download_time_seconds INTEGER,
  restore_time_seconds INTEGER,
  verify_time_seconds INTEGER,
  restored_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for monitoring queries
CREATE INDEX idx_backup_metrics_created_at ON "backup_metrics"(created_at DESC);
CREATE INDEX idx_backup_metrics_restored_at ON "backup_metrics"(restored_at DESC);
CREATE INDEX idx_backup_metrics_backup_size ON "backup_metrics"(backup_size_bytes);

-- Add comment for documentation
COMMENT ON TABLE "backup_metrics" IS 'Tracks database backup and restore operations for monitoring and SLA compliance';
COMMENT ON COLUMN "backup_metrics".backup_key IS 'S3 path to the backup file (e.g., s3://bucket-name/daily/2024-01-01T00:00:00Z.dump)';
COMMENT ON COLUMN "backup_metrics".backup_size_bytes IS 'Size of the backup file in bytes';
COMMENT ON COLUMN "backup_metrics".dump_time_seconds IS 'Time taken to dump database in seconds';
COMMENT ON COLUMN "backup_metrics".upload_time_seconds IS 'Time taken to upload backup to S3 in seconds';
COMMENT ON COLUMN "backup_metrics".download_time_seconds IS 'Time taken to download backup from S3 in seconds';
COMMENT ON COLUMN "backup_metrics".restore_time_seconds IS 'Time taken to restore backup in seconds';
COMMENT ON COLUMN "backup_metrics".verify_time_seconds IS 'Time taken to verify restored database in seconds';
COMMENT ON COLUMN "backup_metrics".restored_at IS 'Timestamp when backup was restored (NULL if only backed up, not restored)';
