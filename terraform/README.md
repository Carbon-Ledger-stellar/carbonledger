# Infrastructure as Code (Terraform)

## Overview

This directory contains Terraform configurations for the Carbon Ledger infrastructure.

## Modules

Each module has its own README with full input/output documentation (terraform-docs style tables) and usage examples.

| Module | Description | Documentation |
|--------|-------------|---------------|
| `postgres` | PostgreSQL database (RDS) | [modules/postgres/README.md](modules/postgres/README.md) |
| `redis` | Redis cache (ElastiCache) | [modules/redis/README.md](modules/redis/README.md) |
| `load-balancer` | API load balancer (ALB) | [modules/load-balancer/README.md](modules/load-balancer/README.md) |
| `cdn` | Frontend CDN (CloudFront + S3) | [modules/cdn/README.md](modules/cdn/README.md) |

## Environments

| Environment | Description | URL | Example tfvars |
|-------------|-------------|-----|----------------|
| `staging` | Staging environment | staging.carbonledger.com | [environments/staging/terraform.tfvars.example](environments/staging/terraform.tfvars.example) |
| `production` | Production environment | carbonledger.com | [environments/production/terraform.tfvars.example](environments/production/terraform.tfvars.example) |

## Prerequisites

- Terraform >= 1.0.0
- AWS CLI configured with appropriate credentials
- S3 bucket for state storage (created manually)

## Usage

### Initialize

```bash
cd terraform/environments/staging
terraform init
terraform plan
terraform apply
terraform destroy
terraform plan
# Check the cost estimation output
infracost breakdown --path=.
```

### Using example tfvars

Copy the example tfvars file for your environment and adjust values as needed:

```bash
cd terraform/environments/staging
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values
terraform plan -var-file=terraform.tfvars
```

## Documentation

Module documentation is generated in [terraform-docs](https://terraform-docs.io/) format. To regenerate the tables after changing variables or outputs:

```bash
terraform-docs markdown table --output-file README.md modules/postgres
terraform-docs markdown table --output-file README.md modules/redis
terraform-docs markdown table --output-file README.md modules/load-balancer
terraform-docs markdown table --output-file README.md modules/cdn