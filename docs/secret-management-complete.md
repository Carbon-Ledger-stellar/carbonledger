# Secret Management — Complete Reference

**Issue:** [#1066](https://github.com/Carbon-Ledger-stellar/carbonledger/issues/1066)  
**Status:** Active | **Last Updated:** 2026-08-29  
**Owner:** Platform / Security Team

---

## Table of Contents

1. [Overview](#overview)
2. [All Secrets in AWS Secrets Manager](#all-secrets-in-aws-secrets-manager)
3. [GitHub Actions Secrets](#github-actions-secrets)
4. [Local Development](#local-development)
5. [Terraform Infrastructure](#terraform-infrastructure)
6. [Access Logs and Audit Trail](#access-logs-and-audit-trail)
7. [Quarterly Rotation Schedule](#quarterly-rotation-schedule)
8. [Automated Rotation (JWT / Postgres / Redis)](#automated-rotation-jwt--postgres--redis)
9. [Manual Rotation Procedures](#manual-rotation-procedures)
10. [No-Secrets Audit](#no-secrets-audit)
11. [Emergency Procedures](#emergency-procedures)

---

## Overview

CarbonLedger uses **AWS Secrets Manager** as the single source of truth for all production and staging secrets. No secret value is ever hardcoded in source code, configuration files, or Terraform state. The `.env` family of files is listed in `.gitignore`, and the `detect-secrets` pre-commit hook (`scripts/pre-commit`) blocks any accidental commit of a high-entropy string.

All Secrets Manager operations are logged to **AWS CloudTrail** and forwarded to **CloudWatch Logs**. A CloudWatch alarm fires on any `GetSecretValue` call that originates outside of the expected ECS task roles or rotation Lambdas (see [Access Logs](#access-logs-and-audit-trail)).

Secrets rotate automatically on a **90-day schedule** via Lambda-backed Secrets Manager rotation. The rotation is zero-downtime: in-flight requests survive using a dual-secret overlap window (15 minutes for JWT, native RDS credential swap for Postgres, AUTH-token rotation strategy for Redis).

---

## All Secrets in AWS Secrets Manager

All secrets follow the naming convention `carbonledger-<env>/<secret-name>` where `<env>` is `staging` or `production`.

### Production Secrets

| Secret ID | AWS Path | Description | Rotation |
|---|---|---|---|
| Postgres credentials | `carbonledger-production/postgres-credentials` | `{username, password, host, port, dbname}` | 90 days (automated, RDS single-user Lambda) |
| Redis password | `carbonledger-production/redis-password` | `{password}` | 90 days (automated, custom Lambda) |
| JWT signing secret | `carbonledger-production/jwt-secret` | `{current, previous, previous_expires_at}` | 90 days (automated, custom Lambda) |
| Oracle secret key | `carbonledger/prod/oracle-secret-key` | Stellar keypair for oracle | Manual quarterly (see [#manual-rotation](#manual-rotation-procedures)) |
| Admin secret key | `carbonledger/prod/admin-secret-key` | Stellar admin keypair | Manual quarterly with multi-sig + time-lock |
| IPFS / Pinata API key | `carbonledger/prod/ipfs-api-key` | Pinata upload key | Manual quarterly |
| IPFS / Pinata secret key | `carbonledger/prod/ipfs-secret-key` | Pinata secret | Manual quarterly |
| Google Earth Engine key | `carbonledger/prod/gee-service-account` | GEE service account JSON | Manual, on credential renewal |
| Planet Labs API key | `carbonledger/prod/planet-labs-api-key` | Planet Labs data access | Manual quarterly |
| Xpansiv API key | `carbonledger/prod/xpansiv-api-key` | Carbon price feed | Manual quarterly |
| Toucan API key | `carbonledger/prod/toucan-api-key` | Carbon bridge price data | Manual quarterly |
| Gold Standard API key | `carbonledger/prod/gold-standard-api-key` | Verifier registry API | Manual quarterly |
| Verra VCS API key | `carbonledger/prod/verra-vcs-api-key` | VCS registry API | Manual quarterly |
| SMTP credentials | `carbonledger/prod/smtp-credentials` | `{host, user, pass, port}` | Manual quarterly |
| Slack alert webhook | `carbonledger/prod/admin-alert-webhook` | Ops notification endpoint | Manual, on workspace change |
| Backend JWT token (oracle) | `carbonledger/prod/backend-jwt-token` | Oracle → backend service account JWT | 90 days (co-rotated with JWT secret) |

### Staging Secrets

Staging uses identical secret IDs under `carbonledger-staging/*` and `carbonledger/staging/*`. Staging secrets are distinct values from production — they are never shared.

### Retrieve a Secret (Authorized Roles Only)

```bash
# Requires IAM permission: secretsmanager:GetSecretValue on the specific ARN
aws secretsmanager get-secret-value \
  --secret-id carbonledger-production/postgres-credentials \
  --query SecretString --output text | jq .

# Get a single field
aws secretsmanager get-secret-value \
  --secret-id carbonledger-production/jwt-secret \
  --query SecretString --output text | jq -r .current
```

Access is scoped to the ECS task IAM role (`carbonledger-production-app`) and the rotation Lambda execution role (`carbonledger-production-rotation-lambda`). No human IAM user has read access to production secret values outside of break-glass procedures.

---

## GitHub Actions Secrets

Secrets injected via GitHub Actions repository secrets (Settings → Secrets and variables → Actions). These are never printed in workflow logs (`add-mask` is implicit for `${{ secrets.* }}`).

| GitHub Secret | Used By | Maps To |
|---|---|---|
| `DATABASE_URL` | backend CI, staging deploy | Staging DB connection string |
| `JWT_SECRET` | backend CI | Test-only JWT secret (not production) |
| `STELLAR_ORACLE_SECRET_KEY` | contract-redeploy workflow | Testnet oracle keypair |
| `STELLAR_ADMIN_SECRET_KEY` | contract-redeploy workflow | Testnet admin keypair |
| `AWS_ACCESS_KEY_ID` | staging/prod deploy | CI deploy role |
| `AWS_SECRET_ACCESS_KEY` | staging/prod deploy | CI deploy role |
| `STAGING_JWT_SECRET_ARN` | key-rotation-test workflow | ARN for automated rotation test |
| `STAGING_POSTGRES_SECRET_ARN` | key-rotation-test workflow | ARN for automated rotation test |
| `STAGING_REDIS_SECRET_ARN` | key-rotation-test workflow | ARN for automated rotation test |
| `STAGING_API_URL` | key-rotation-test workflow | Staging API base URL |

---

## Local Development

1. Copy the example file — this creates an untracked file that is never committed:
   ```bash
   cp .env.example .env
   ```
2. Fill in the values. For Oracle/Admin Stellar keypairs, generate a funded testnet account:
   ```bash
   stellar keys generate deployer --network testnet --fund
   ```
3. Use any value for `JWT_SECRET` locally (e.g. `openssl rand -hex 32`).
4. Do not use production or staging values locally. Each environment has its own secrets.

The following files are listed in `.gitignore` and will never be committed:

```
.env
.env.local
.env.*.local
.env.staging
.env.production
*.tfvars.local
*.tfvars.secret
```

---

## Terraform Infrastructure

Secrets are provisioned in `infra/main/secrets.tf`. Key design decisions:

- `recovery_window_in_days = 7` on all secrets (allows accidental delete recovery).
- Initial secret values are seeded at first `terraform apply` using `random_password` resources.
- After the first rotation, the Lambda owns the value — Terraform does **not** track the live secret value (see `lifecycle { ignore_changes = [secret_string] }`).
- A VPC interface endpoint (`aws_vpc_endpoint.secretsmanager`) ensures rotation Lambdas reach Secrets Manager without a NAT gateway, keeping traffic inside AWS.

All three automated secrets (JWT, Postgres, Redis) rotate on a **90-day schedule** (`rotation_rules { automatically_after_days = 90 }`). See `infra/main/secrets.tf`.

---

## Access Logs and Audit Trail

### CloudTrail

All `secretsmanager:GetSecretValue`, `secretsmanager:PutSecretValue`, and `secretsmanager:RotateSecret` API calls are recorded in the AWS CloudTrail trail associated with the account. CloudTrail logs are shipped to an S3 bucket (`carbonledger-cloudtrail-<account-id>`) with:

- Server-side encryption (SSE-KMS)
- Bucket versioning enabled
- Object-level logging for the CloudTrail bucket itself
- 365-day retention lifecycle

### CloudWatch Alarm — Unexpected Secret Access

A CloudWatch metric filter (`SecretAccessOutsideTaskRole`) monitors the CloudTrail log group for `GetSecretValue` events that originate from a principal that is **not** the expected ECS task role or the rotation Lambda execution role. The alarm (`SecretAccessAnomalyAlarm`) triggers an SNS notification to the ops pager if any such call occurs.

See `infra/main/cloudwatch.tf` — resource `aws_cloudwatch_log_metric_filter.secret_access` and `aws_cloudwatch_metric_alarm.secret_access_anomaly`.

To query access logs manually:

```bash
# CloudWatch Insights — last 7 days of GetSecretValue calls
aws logs start-query \
  --log-group-name "carbonledger-cloudtrail" \
  --start-time $(date -d '-7 days' +%s) \
  --end-time $(date +%s) \
  --query-string 'fields @timestamp, userIdentity.arn, requestParameters.secretId
    | filter eventSource="secretsmanager.amazonaws.com"
    | filter eventName="GetSecretValue"
    | sort @timestamp desc'
```

### Audit Trail in Application Logs

- Every `SecretsRefreshService.refresh()` call logs `"Rotated secrets refreshed in memory (no restart), generation=N"` at INFO level.
- Every Lambda invocation logs the secret ID, step, and outcome to CloudWatch Logs under `/aws/lambda/carbonledger-<env>-rotate-*`.
- Oracle `secrets_manager.py` logs each refresh at INFO level: `"Rotated secrets refreshed in memory (no restart), generation=N"`.

---

## Quarterly Rotation Schedule

Quarterly rotation is defined as **every 90 days**. The three automated secrets (JWT, Postgres, Redis) rotate automatically via Secrets Manager. The remaining secrets require a manual rotation by a member of the Platform/Security team.

### Rotation Calendar

| Quarter | Start Date | Action |
|---|---|---|
| Q1 | January 1 | Rotate all manual secrets (oracle key, admin key, API keys, SMTP) |
| Q2 | April 1 | Rotate all manual secrets |
| Q3 | July 1 | Rotate all manual secrets |
| Q4 | October 1 | Rotate all manual secrets + annual key pair review |

Automated secrets (JWT, Postgres, Redis) are triggered independently every 90 days from the date of the last rotation. The exact date is visible in the AWS Console under Secrets Manager → secret → "Rotation configuration".

### Checklist — Quarterly Manual Rotation

Run this checklist at the start of each quarter:

```
[ ] 1. Oracle keypair rotation
        POST /api/v1/key-rotation/oracle  (new keypair, reason="Q<N> rotation")
        Verify oracle submissions continue working in staging before production.

[ ] 2. Admin keypair rotation
        POST /api/v1/key-rotation/admin  (multi-sig required, timeLockHours=48)
        Approve via second admin within the time-lock window.

[ ] 3. IPFS / Pinata API keys
        Generate new keys in Pinata dashboard.
        Update carbonledger/prod/ipfs-api-key and carbonledger/prod/ipfs-secret-key in Secrets Manager.
        Update carbonledger/staging/ipfs-api-key and carbonledger/staging/ipfs-secret-key.
        Restart oracle services or send SIGHUP.

[ ] 4. Satellite data API keys (GEE, Planet Labs)
        Rotate via respective provider consoles.
        Update carbonledger/prod/gee-service-account and carbonledger/prod/planet-labs-api-key.
        Verify satellite monitor webhook is receiving data.

[ ] 5. Carbon price feed keys (Xpansiv, Toucan)
        Rotate via provider portals.
        Update carbonledger/prod/xpansiv-api-key and carbonledger/prod/toucan-api-key.
        Monitor price oracle for first successful price update after rotation.

[ ] 6. Verifier API keys (Gold Standard, Verra)
        Rotate via provider portals.
        Update in Secrets Manager.
        Verify a test project verification request succeeds.

[ ] 7. SMTP credentials
        Rotate in email provider dashboard.
        Update carbonledger/prod/smtp-credentials.
        Send a test notification email.

[ ] 8. Confirm automated secrets have rotated on schedule
        aws secretsmanager describe-secret \
          --secret-id carbonledger-production/jwt-secret \
          --query '{last: LastRotatedDate, next: NextRotationDate}'
        (repeat for postgres-credentials and redis-password)

[ ] 9. Review CloudWatch alarm for any anomalous access in the past quarter
        See CloudWatch → Alarms → SecretAccessAnomalyAlarm.

[ ] 10. Update rotation log in this file (date + who performed rotation)
```

### Rotation Log

| Date | Rotated By | Secrets Rotated | Notes |
|---|---|---|---|
| 2026-08-29 | Initial setup | All automated (JWT, Postgres, Redis) | First terraform apply; automated rotation enabled |

---

## Automated Rotation (JWT / Postgres / Redis)

See `docs/KEY_ROTATION_PROCEDURES.md` → section "Automated Secrets Manager Rotation" for the full technical specification.

Summary:
- **Schedule:** every 90 days (was 30 days — updated in `infra/main/secrets.tf` as part of #1066).
- **JWT:** custom Lambda, 15-minute dual-secret overlap. Backend picks up via `SecretsRefreshService` (SIGHUP or 5-min poll).
- **Postgres:** AWS-managed RDS single-user rotation template via Serverless Application Repository.
- **Redis:** custom Lambda, ElastiCache `ROTATE` strategy. Oracle detects rotation via `refresh_generation` counter.
- **Zero downtime:** all three secrets survive rotation without restarting any service.

Force an immediate rotation (requires AWS credentials with `secretsmanager:RotateSecret`):

```bash
aws secretsmanager rotate-secret \
  --secret-id carbonledger-production/jwt-secret
```

---

## Manual Rotation Procedures

### Oracle Keypair

```bash
# Generate new keypair on Stellar testnet (replace --network with public for mainnet)
stellar keys generate oracle-new --network testnet

# Get the public key
stellar keys address oracle-new

# Initiate rotation via API (staging first, then production)
curl -X POST https://api.carbonledger.io/api/v1/key-rotation/oracle \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "newOraclePublicKey": "GNEW...",
    "newOracleSecretKey": "SNEW...",
    "reason": "Q3 2026 quarterly rotation"
  }'

# Update Secrets Manager after on-chain rotation completes
aws secretsmanager put-secret-value \
  --secret-id carbonledger/prod/oracle-secret-key \
  --secret-string '{"public_key":"GNEW...","secret_key":"SNEW..."}'
```

### Admin Keypair (Multi-Sig + Time-Lock)

```bash
# Generate new keypair
stellar keys generate admin-new --network testnet

# Initiate rotation (requires two admins to approve; 48h time-lock)
curl -X POST https://api.carbonledger.io/api/v1/key-rotation/admin \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "newAdminPublicKey": "GNEW...",
    "newAdminSecretKey": "SNEW...",
    "reason": "Q3 2026 quarterly rotation",
    "multiSigRequired": true,
    "timeLockHours": 48
  }'
```

---

## No-Secrets Audit

The following controls prevent secrets from entering version control:

1. **`.gitignore`** — all `.env*` files and `*.tfvars.local`/`*.tfvars.secret` patterns are ignored.
2. **`detect-secrets` pre-commit hook** — configured in `.secrets.baseline`. Any high-entropy string that matches a secret pattern blocks the commit. Install with `bash scripts/setup-hooks.sh`.
3. **`.pre-commit-config.yaml`** — includes `detect-secrets` hook.
4. **Terraform variables** — `db_password` and other credentials are passed via `-var` flags or environment variables, never hardcoded in `.tf` or `.tfvars` files.
5. **GitHub Actions** — all secret values are injected via `${{ secrets.* }}` which are redacted from logs.
6. **CI scan** — `container-security-scan.yml` runs Trivy on all container images; `.trivyignore` documents any accepted false-positives.

To verify no secrets are in git history:

```bash
# Run detect-secrets scan across the whole repo
pip install detect-secrets
detect-secrets scan --baseline .secrets.baseline

# If the baseline is clean (results: {}), no secrets are detected
```

---

## Emergency Procedures

### Suspected Secret Compromise

1. **Immediately rotate** the affected secret:
   ```bash
   aws secretsmanager rotate-secret --secret-id <arn> --rotate-immediately
   ```
2. **Revoke** any long-lived tokens derived from the compromised secret (JWT tokens, API keys).
3. **Review CloudTrail** for any API calls made using the compromised credential in the last 90 days.
4. **Notify** the security team at security@carbonledger.io and the on-call engineer via the Slack `#incidents` channel.
5. **Open a security incident** — do not open a public GitHub issue.
6. **Post-incident review** within 5 business days.

See `docs/runbooks/key-compromise.md` for the full runbook.

### Secret Accidentally Committed to Git

1. Treat the secret as compromised — rotate it immediately (step above).
2. Remove the secret from git history:
   ```bash
   git filter-repo --path <file-with-secret> --invert-paths
   git push --force-with-lease origin <branch>
   ```
3. Force all collaborators to re-clone or reset their local branches.
4. Audit who may have pulled the branch.
5. Contact GitHub support to purge cached copies if the repository is public.
