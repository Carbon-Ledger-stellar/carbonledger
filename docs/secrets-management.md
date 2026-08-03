# Secrets Management

## Rules

1. **Never commit real secret values.** `.env` is in `.gitignore`. `.env.example` contains only empty placeholders.
2. **Pre-commit hook** blocks commits containing secret patterns. Install it:
   ```bash
   bash scripts/setup-hooks.sh
   ```

## Local Development

```bash
cp .env.example .env
# Fill in values — this file is gitignored and never committed
```

## Production Secrets — AWS Secrets Manager

All production secrets are stored in AWS Secrets Manager under the path `carbonledger/<env>/<key>`.

| Secret Name | AWS Path |
|---|---|
| `ORACLE_SECRET_KEY` | `carbonledger/prod/oracle-secret-key` |
| `ADMIN_SECRET_KEY` | `carbonledger/prod/admin-secret-key` |
| `JWT_SECRET` | `carbonledger/prod/jwt-secret` |
| `DATABASE_URL` | `carbonledger/prod/database-url` |
| `IPFS_SECRET_KEY` | `carbonledger/prod/ipfs-secret-key` |

Retrieve at runtime:
```bash
aws secretsmanager get-secret-value \
  --secret-id carbonledger/prod/oracle-secret-key \
  --query SecretString --output text
```

The ECS task role has `secretsmanager:GetSecretValue` scoped to `carbonledger/*`.

## CI — GitHub Actions Secrets

Secrets are injected via GitHub Actions repository secrets (Settings → Secrets and variables → Actions).

Required secrets:

| Secret | Used by |
|---|---|
| `DATABASE_URL` | backend CI, staging deploy |
| `JWT_SECRET` | backend CI |
| `STELLAR_ORACLE_SECRET_KEY` | contract-redeploy workflow |
| `STELLAR_ADMIN_SECRET_KEY` | contract-redeploy workflow |
| `AWS_ACCESS_KEY_ID` | staging/prod deploy |
| `AWS_SECRET_ACCESS_KEY` | staging/prod deploy |

These are referenced in workflows as `${{ secrets.SECRET_NAME }}` and are never printed in logs.
