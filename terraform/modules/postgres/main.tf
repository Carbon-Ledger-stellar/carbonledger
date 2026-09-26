resource "aws_db_instance" "postgres" {
    identifier     = var.identifier
    engine         = "postgres"
    engine_version = var.engine_version
    instance_class = var.instance_class

    allocated_storage     = var.allocated_storage
    max_allocated_storage = var.max_allocated_storage
    storage_encrypted     = true
    storage_type          = "gp3"

    db_name  = var.db_name
    username = var.username
    password = var.password

    vpc_security_group_ids = [aws_security_group.postgres.id]
    db_subnet_group_name   = aws_db_subnet_group.postgres.name

    backup_retention_period = var.backup_retention_period
    backup_window          = var.backup_window
    maintenance_window     = var.maintenance_window

    deletion_protection = var.deletion_protection
    skip_final_snapshot = var.skip_final_snapshot

    enabled_cloudwatch_logs_exports = ["postgresql"]

    tags = var.tags
}

resource "aws_security_group" "postgres" {
    name        = "${var.identifier}-sg"
    description = "Security group for PostgreSQL database"
    vpc_id      = var.vpc_id

    ingress {
        from_port       = 5432
        to_port         = 5432
        protocol        = "tcp"
        security_groups = [var.ingress_security_group_id]
    }

    egress {
        from_port   = 0
        to_port     = 0
        protocol    = "-1"
        cidr_blocks = ["0.0.0.0/0"]
    }

    tags = var.tags
}

resource "aws_db_subnet_group" "postgres" {
    name       = "${var.identifier}-subnet-group"
    subnet_ids = var.subnet_ids

    tags = var.tags
}

# Automated backups
resource "aws_db_instance_automated_backups_replication" "postgres" {
    count = var.replicate_to_region != "" ? 1 : 0

    source_db_instance_arn = aws_db_instance.postgres.arn
    retention_period       = var.backup_retention_period
    kms_key_id             = var.kms_key_id

    depends_on = [aws_db_instance.postgres]
}
