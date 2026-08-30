# CarbonLedger Infrastructure

Terraform IaC for all CarbonLedger cloud resources. Closes #74 / #685.

## Structure

```
infra/
├── bootstrap/    # One-time: creates S3 state bucket + DynamoDB lock table
└── main/         # All application resources (compute, DB, Redis, S3, CloudWatch)
    ├── main.tf           – provider + remote backend
    ├── variables.tf      – input variables (all resource types + feature flags)
    ├── networking.tf     – VPC, subnets, routing
    ├── compute.tf        – EC2 app server + IAM role
    ├── database.tf       – RDS PostgreSQL
    ├── redis.tf          – ElastiCache Redis HA (3-node Sentinel)
    ├── storage.tf        – S3 assets, DB backups, IPFS backup buckets
    ├── cloudwatch.tf     – CloudWatch log groups + metric alarms
    ├── backend.hcl       – remote state config (fill in account ID)
    ├── staging.tfvars    – staging workspace sizing
    └── production.tfvars – production workspace sizing
```

---

## Environment Parity Policy

> **Rule:** Staging and production provision the **same resource types**.
> The only allowed differences are instance/node **sizes** and **retention periods**.

This prevents the class of bugs where something works in production but fails
to reproduce in staging due to a missing service.

### Allowed differences (staging vs. production)

| Resource | Staging | Production |
|---|---|---|
| EC2 app server | t3.small | t3.medium |
| RDS PostgreSQL 16 | db.t3.micro | db.t3.small |
| ElastiCache Redis 7 | cache.t3.micro | cache.t3.small |
| CloudWatch log retention | 30 days | 90 days |
| Redis in-transit TLS | false | true |

### NOT allowed differences

| Feature | Both environments |
|---|---|
| Redis HA topology | 3-node Sentinel (`enable_redis_sentinel = true`) |
| S3 IPFS backup bucket | ✓ provisioned |
| S3 DB backup bucket | ✓ provisioned |
| CloudWatch log groups | ✓ backend, frontend, oracle, nginx, contracts |
| CloudWatch alarms | ✓ CPU, storage, Redis evictions, error rate |
| RDS Multi-AZ | ✓ (see database.tf) |

---

## First-time Setup

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

---

## Deploying

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

---

## CI — terraform plan Comment on PRs

Any PR that touches `infra/` triggers the `terraform-plan` GitHub Actions job
(see `.github/workflows/staging.yml`).  It posts a comment with the plan diff
for both workspaces so reviewers can verify the parity policy before merging.

Example PR comment:

```
### Terraform Plan — staging
Plan: 2 to add, 1 to change, 0 to destroy.

### Terraform Plan — production  
Plan: 2 to add, 1 to change, 0 to destroy.
```

---

## Drift Check

```bash
# Check for drift (should always show "No changes" on a clean deploy)
terraform plan -var-file=staging.tfvars    -var="db_username=x" -var="db_password=x"
terraform plan -var-file=production.tfvars -var="db_username=x" -var="db_password=x"
```

---

## Resources Provisioned

| Resource | Staging | Production |
|---|---|---|
| EC2 app server | t3.small | t3.medium |
| RDS PostgreSQL 16 | db.t3.micro | db.t3.small |
| ElastiCache Redis 7 (3-node HA) | cache.t3.micro | cache.t3.small |
| S3 assets bucket | ✓ | ✓ |
| S3 DB backups bucket | ✓ | ✓ |
| S3 IPFS backup bucket | ✓ | ✓ |
| CloudWatch log groups (5) | ✓ | ✓ |
| CloudWatch metric alarms (6) | ✓ | ✓ |
| SNS alarm topic | ✓ | ✓ |
| S3 state bucket | shared | shared |
| DynamoDB lock table | shared | shared |

All resources are tagged with `Project=carbonledger`, `Environment=<workspace>`, `ManagedBy=terraform`.

---

## Redis HA Details

Both environments provision a **3-node Redis Sentinel cluster** via ElastiCache:

```
┌─────────────────────────────────────────────┐
│  ElastiCache Replication Group              │
│                                             │
│  Primary (AZ-a)  ──replication──▶  Replica (AZ-b)  │
│                  ──replication──▶  Replica (AZ-c)  │
│                                             │
│  automatic_failover_enabled = true          │
│  multi_az_enabled = true                    │
│  num_cache_clusters = 3                     │
└─────────────────────────────────────────────┘
```

With 3 nodes, ElastiCache can promote a replica to primary even if one AZ is lost,
achieving the same HA guarantee as a standalone Redis Sentinel deployment.

The `enable_redis_sentinel` variable defaults to `true` and **must not be set to
`false` in either staging or production** to maintain environment parity.

---

## CloudWatch Log Groups

| Group | Source |
|---|---|
| `/carbonledger/<env>/backend` | NestJS backend (Pino JSON → CloudWatch agent) |
| `/carbonledger/<env>/frontend` | Next.js (stdout) |
| `/carbonledger/<env>/oracle` | Python oracle services |
| `/carbonledger/<env>/nginx` | Nginx access + error logs |
| `/carbonledger/<env>/contracts` | Stellar contract event indexer |

Configure the CloudWatch agent on the EC2 instance to ship logs to these groups.
See `scripts/setup-cloudwatch.sh` for the agent configuration (now superseded by
Terraform for resource provisioning; the script handles agent installation).

---

## CloudWatch Alarms

| Alarm | Threshold | Action |
|---|---|---|
| EC2 CPU high | > 80% for 5 min | SNS → email |
| RDS CPU high | > 80% for 5 min | SNS → email |
| RDS free storage low | < 2 GiB | SNS → email |
| Redis CPU high | > 70% for 5 min | SNS → email |
| Redis evictions | > 0 | SNS → email |
| Backend error rate high | > 10 errors/5 min | SNS → email |

Set `cloudwatch_alarm_email` in the relevant `.tfvars` to receive email alerts.
