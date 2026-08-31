# Infrastructure as Code (Terraform)

## Overview

This directory contains Terraform configurations for the Carbon Ledger infrastructure.

## Modules

| Module | Description |
|--------|-------------|
| `postgres` | PostgreSQL database (RDS) |
| `redis` | Redis cache (ElastiCache) |
| `load-balancer` | API load balancer (ALB) |
| `cdn` | Frontend CDN (CloudFront + S3) |

## Environments

| Environment | Description | URL |
|-------------|-------------|-----|
| `staging` | Staging environment | staging.carbonledger.com |
| `production` | Production environment | carbonledger.com |

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
