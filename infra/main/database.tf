# ── Security Group ────────────────────────────────────────────────────────────

resource "aws_security_group" "db" {
  name   = "${local.name}-db-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  tags = { Name = "${local.name}-db-sg" }
}

# ── Subnet group ──────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id
}

# ── RDS parameter group — reduce max_connections to match pooler ──────────────
#
# Without PgBouncer, Postgres defaulted to max_connections=100 (the RDS
# default). With PgBouncer in front, the total server-side connections are:
#   default_pool_size (25) + reserve_pool_size (5) = 30 application connections
#   + 5 reserved for migrations, monitoring, and superuser connections
#   = 35 expected peak  →  max_connections=50 gives comfortable headroom.
#
# Setting max_connections lower reduces per-connection shared_buffers overhead
# and prevents accidental direct connections from starving the pool.
# See: https://wiki.postgresql.org/wiki/Number_Of_Database_Connections
#
resource "aws_db_parameter_group" "postgres" {
  name        = "${local.name}-postgres-params"
  family      = "postgres16"
  description = "CarbonLedger PostgreSQL 16 — connection limits tuned for PgBouncer"

  # max_connections: total server connections Postgres will accept.
  # Sized for PgBouncer pooler: 25 (pool) + 5 (reserve) + 5 (admin/migrations)
  # + 15 (superuser + monitoring headroom) = 50.
  parameter {
    name         = "max_connections"
    value        = var.postgres_max_connections
    apply_method = "pending-reboot"
  }

  tags = { Name = "${local.name}-postgres-params" }
}

# ── RDS PostgreSQL ────────────────────────────────────────────────────────────

resource "aws_db_instance" "postgres" {
  identifier        = "${local.name}-postgres"
  engine            = "postgres"
  engine_version    = "16"
  instance_class    = var.db_instance_class
  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "carbonledger"
  username = var.db_username
  password = var.db_password

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]

  # Use the parameter group that sets max_connections=50 (pooler-tuned).
  parameter_group_name = aws_db_parameter_group.postgres.name

  backup_retention_period = 30
  skip_final_snapshot     = terraform.workspace != "production"
  deletion_protection     = terraform.workspace == "production"

  tags = { Name = "${local.name}-postgres" }
}

output "db_endpoint" { value = aws_db_instance.postgres.endpoint }
