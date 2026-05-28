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

  backup_retention_period = 7
  skip_final_snapshot     = terraform.workspace != "production"
  deletion_protection     = terraform.workspace == "production"

  tags = { Name = "${local.name}-postgres" }
}

output "db_endpoint" { value = aws_db_instance.postgres.endpoint }
