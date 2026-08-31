############################################
# Secrets Manager — JWT / Postgres / Redis
#
# NEW FILE. Adds to the existing infra/main/ stack (main.tf,
# networking.tf, database.tf, redis.tf, compute.tf) — reuses
# aws_vpc.main, aws_subnet.private, local.name, terraform.workspace
# rather than introducing parallel resources.
############################################

# ── Lambda networking ──────────────────────────────────────────────
# Rotation Lambdas run in the private subnets so they can reach RDS /
# ElastiCache directly. There's no NAT gateway today (see
# networking.tf — only the public route table has one), so instead of
# adding a NAT gateway just for this, use a VPC interface endpoint for
# Secrets Manager.

resource "aws_security_group" "rotation_lambda" {
  name   = "${local.name}-rotation-lambda-sg"
  vpc_id = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-rotation-lambda-sg" }
}

resource "aws_security_group" "secretsmanager_endpoint" {
  name   = "${local.name}-secretsmanager-endpoint-sg"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port       = 443
    to_port         = 443
    protocol        = "tcp"
    security_groups = [aws_security_group.rotation_lambda.id]
  }

  tags = { Name = "${local.name}-secretsmanager-endpoint-sg" }
}

resource "aws_vpc_endpoint" "secretsmanager" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.secretsmanager"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.secretsmanager_endpoint.id]
  private_dns_enabled = true

  tags = { Name = "${local.name}-secretsmanager-endpoint" }
}

# Let the rotation Lambdas reach RDS and Redis on their existing ports.
resource "aws_security_group_rule" "db_from_rotation_lambda" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.db.id
  source_security_group_id = aws_security_group.rotation_lambda.id
}

resource "aws_security_group_rule" "redis_from_rotation_lambda" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.redis.id
  source_security_group_id = aws_security_group.rotation_lambda.id
}

############################################
# Secrets — Postgres now sourced from Secrets Manager instead of the
# raw var.db_password. RDS's own password field still needs a value at
# create time, so the secret's initial version mirrors the existing
# tfvars-supplied credentials, then the rotation Lambda takes over.
############################################

resource "aws_secretsmanager_secret" "postgres" {
  name                    = "${local.name}/postgres-credentials"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name}-postgres-secret" }
}

resource "aws_secretsmanager_secret_version" "postgres" {
  secret_id = aws_secretsmanager_secret.postgres.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password
    host     = aws_db_instance.postgres.address
    port     = 5432
    dbname   = "carbonledger"
  })

  lifecycle {
    ignore_changes = [secret_string] # rotation Lambda owns this after the first apply
  }
}

resource "aws_secretsmanager_secret" "redis" {
  name                    = "${local.name}/redis-password"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name}-redis-secret" }
}

resource "random_password" "redis_bootstrap" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id     = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({ password = random_password.redis_bootstrap.result })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.name}/jwt-secret"
  recovery_window_in_days = 7
  tags                    = { Name = "${local.name}-jwt-secret" }
}

resource "random_password" "jwt_bootstrap" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({
    current             = random_password.jwt_bootstrap.result
    previous            = ""
    previous_expires_at = ""
  })

  lifecycle {
    ignore_changes = [secret_string]
  }
}

############################################
# IAM — rotation Lambda execution role
############################################

data "aws_iam_policy_document" "rotation_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rotation_lambda" {
  name               = "${local.name}-rotation-lambda"
  assume_role_policy = data.aws_iam_policy_document.rotation_assume.json
}

data "aws_iam_policy_document" "rotation_permissions" {
  statement {
    sid = "SecretsManagerRotation"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecretVersionStage",
    ]
    resources = [
      aws_secretsmanager_secret.jwt.arn,
      aws_secretsmanager_secret.redis.arn,
    ]
  }
  statement {
    sid       = "RandomPassword"
    actions   = ["secretsmanager:GetRandomPassword"]
    resources = ["*"]
  }
  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:*:*:*"]
  }
  statement {
    sid       = "VpcNetworking"
    actions   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DeleteNetworkInterface"]
    resources = ["*"]
  }
  statement {
    sid       = "ElastiCacheAuthUpdate"
    actions   = ["elasticache:ModifyReplicationGroup", "elasticache:DescribeReplicationGroups"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "rotation_lambda" {
  name   = "${local.name}-rotation-lambda-policy"
  role   = aws_iam_role.rotation_lambda.id
  policy = data.aws_iam_policy_document.rotation_permissions.json
}

############################################
# JWT rotation Lambda
############################################

data "archive_file" "rotate_jwt" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/rotate_jwt_secret"
  output_path = "${path.module}/build/rotate_jwt_secret.zip"
}

resource "aws_lambda_function" "rotate_jwt" {
  function_name    = "${local.name}-rotate-jwt-secret"
  role             = aws_iam_role.rotation_lambda.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.rotate_jwt.output_path
  source_code_hash = data.archive_file.rotate_jwt.output_base64sha256

  environment {
    variables = { OVERLAP_SECONDS = "900" } # 15-minute overlap
  }

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.rotation_lambda.id]
  }
}

resource "aws_lambda_permission" "rotate_jwt_invoke" {
  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rotate_jwt.function_name
  principal     = "secretsmanager.amazonaws.com"
}

resource "aws_secretsmanager_secret_rotation" "jwt" {
  secret_id           = aws_secretsmanager_secret.jwt.id
  rotation_lambda_arn = aws_lambda_function.rotate_jwt.arn
  # Quarterly rotation per issue #1066 acceptance criteria (rotate secrets quarterly)
  rotation_rules { automatically_after_days = 90 }
  depends_on = [aws_lambda_permission.rotate_jwt_invoke]
}

############################################
# Redis rotation Lambda
############################################

data "archive_file" "rotate_redis" {
  type        = "zip"
  source_dir  = "${path.module}/../../lambda/rotate_redis_password"
  output_path = "${path.module}/build/rotate_redis_password.zip"
}

resource "aws_lambda_function" "rotate_redis" {
  function_name    = "${local.name}-rotate-redis-password"
  role             = aws_iam_role.rotation_lambda.arn
  handler          = "handler.lambda_handler"
  runtime          = "python3.12"
  timeout          = 30
  filename         = data.archive_file.rotate_redis.output_path
  source_code_hash = data.archive_file.rotate_redis.output_base64sha256

  environment {
    variables = {
      ELASTICACHE_REPLICATION_GROUP_ID = aws_elasticache_replication_group.redis.replication_group_id
    }
  }

  vpc_config {
    subnet_ids         = aws_subnet.private[*].id
    security_group_ids = [aws_security_group.rotation_lambda.id]
  }
}

resource "aws_lambda_permission" "rotate_redis_invoke" {
  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rotate_redis.function_name
  principal     = "secretsmanager.amazonaws.com"
}

resource "aws_secretsmanager_secret_rotation" "redis" {
  secret_id           = aws_secretsmanager_secret.redis.id
  rotation_lambda_arn = aws_lambda_function.rotate_redis.arn
  # Quarterly rotation per issue #1066 acceptance criteria (rotate secrets quarterly)
  rotation_rules { automatically_after_days = 90 }
  depends_on = [aws_lambda_permission.rotate_redis_invoke]
}

############################################
# Postgres rotation — AWS-managed RDS single-user rotation template,
# deployed via the Serverless Application Repository, per the
# acceptance criteria ("uses RDS rotation template").
############################################

resource "aws_serverlessapplicationrepository_cloudformation_stack" "rotate_postgres" {
  name             = "${local.name}-rotate-postgres-credentials"
  application_id   = "arn:aws:serverlessrepo:us-east-1:297356227824:applications/SecretsManagerRDSPostgreSQLRotationSingleUser"
  semantic_version = "1.1.171"
  capabilities     = ["CAPABILITY_IAM", "CAPABILITY_RESOURCE_POLICY"]

  parameters = {
    endpoint             = "https://secretsmanager.${var.aws_region}.amazonaws.com"
    functionName         = "${local.name}-rotate-postgres-credentials"
    vpcSecurityGroupIds  = aws_security_group.rotation_lambda.id
    vpcSubnetIds         = join(",", aws_subnet.private[*].id)
  }
}

resource "aws_lambda_permission" "rotate_postgres_invoke" {
  statement_id  = "AllowSecretsManagerInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_serverlessapplicationrepository_cloudformation_stack.rotate_postgres.outputs["RotationLambdaARN"]
  principal     = "secretsmanager.amazonaws.com"
}

resource "aws_secretsmanager_secret_rotation" "postgres" {
  secret_id           = aws_secretsmanager_secret.postgres.id
  rotation_lambda_arn = aws_serverlessapplicationrepository_cloudformation_stack.rotate_postgres.outputs["RotationLambdaARN"]
  # Quarterly rotation per issue #1066 acceptance criteria (rotate secrets quarterly)
  rotation_rules { automatically_after_days = 90 }
}
