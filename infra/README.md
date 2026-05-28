# CarbonLedger Infrastructure

Terraform IaC for all CarbonLedger cloud resources. Closes #74.

## Structure

```
infra/
├── bootstrap/   # One-time: creates S3 state bucket + DynamoDB lock table
└── main/        # All application resources (compute, DB, Redis, S3)
    ├── main.tf          – provider + remote backend
    ├── variables.tf     – input variables
    ├── networking.tf    – VPC, subnets, routing
    ├── compute.tf       – EC2 app server + IAM role
    ├── database.tf      – RDS PostgreSQL
    ├── redis.tf         – ElastiCache Redis
    ├── storage.tf       – S3 assets bucket
    ├── backend.hcl      – remote state config (fill in account ID)
    ├── staging.tfvars   – staging workspace sizing
    └── production.tfvars – production workspace sizing
```

## First-time setup

### 1. Bootstrap remote state

```bash
cd infra/bootstrap
terraform init
terraform apply -var="aws_account_id=<YOUR_ACCOUNT_ID>"
```

Note the `state_bucket` and `lock_table` outputs.

### 2. Fill in backend.hcl

Edit `infra/main/backend.hcl` and replace `<ACCOUNT_ID>` with your AWS account ID.

### 3. Init with remote backend

```bash
cd infra/main
terraform init -backend-config=backend.hcl
```

## Workspaces

```bash
# Staging
terraform workspace new staging   # first time only
terraform workspace select staging
terraform apply -var-file=staging.tfvars \
  -var="db_username=carbonledger" \
  -var="db_password=<SECRET>"

# Production
terraform workspace new production   # first time only
terraform workspace select production
terraform apply -var-file=production.tfvars \
  -var="db_username=carbonledger" \
  -var="db_password=<SECRET>"
```

## Drift check

```bash
terraform plan -var-file=staging.tfvars   # should show "No changes"
```

## Resources provisioned

| Resource | Staging | Production |
|---|---|---|
| EC2 app server | t3.small | t3.medium |
| RDS PostgreSQL 16 | db.t3.micro | db.t3.small |
| ElastiCache Redis 7 | cache.t3.micro | cache.t3.small |
| S3 assets bucket | ✓ | ✓ |
| S3 state bucket | shared | shared |
| DynamoDB lock table | shared | shared |

All resources are tagged with `Project=carbonledger`, `Environment=<workspace>`, `ManagedBy=terraform`.
