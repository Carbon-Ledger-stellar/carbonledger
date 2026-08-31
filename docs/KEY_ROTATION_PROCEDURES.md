# Key Rotation Procedures

This document outlines the procedures for rotating oracle keypair, admin keypair, and JWT secret without service interruption.

## Overview

The CarbonLedger platform implements secure key rotation procedures to ensure:
- **Zero-downtime** operations during key transitions
- **Multi-sig protection** for admin key changes
- **Gradual transition** for JWT secrets
- **Audit trail** for all rotation activities

## Oracle Key Rotation

### Procedure

1. **Preparation**
   - Generate new oracle keypair
   - Validate new keypair cryptographic properties
   - Backup current oracle keys securely

2. **Registration Phase**
   - New oracle key is registered on-chain via `rotate_oracle` function
   - Old oracle key remains active during this phase
   - System validates new oracle functionality

3. **Transition Phase**
   - Environment variables are updated with new keys
   - Service restart with new configuration
   - Old oracle key is deprecated on-chain

4. **Verification**
   - Test oracle operations with new keypair
   - Monitor system for any issues
   - Archive old keys securely

### API Usage

```bash
POST /api/v1/key-rotation/oracle
{
  "newOraclePublicKey": "GABC...",
  "newOracleSecretKey": "SABC...",
  "reason": "Quarterly security rotation",
  "scheduledAt": "2024-01-15T10:00:00Z"
}
```

### Acceptance Criteria Met

✅ **New key registered on-chain before old key deactivated**
✅ **Service interruption prevented**
✅ **Audit trail maintained**

## Admin Key Rotation

### Procedure

1. **Multi-Sig Requirement**
   - Admin key rotation requires multi-signature approval
   - Time-lock can be enforced (24-168 hours)
   - Multiple admins must approve the rotation

2. **Time-Lock Phase**
   - Rotation request is created with scheduled execution
   - Time-lock prevents immediate changes
   - Allows for review and approval period

3. **Execution Phase**
   - After time-lock expires, rotation is executed
   - New admin key is activated
   - Old admin key is deprecated

### API Usage

```bash
POST /api/v1/key-rotation/admin
{
  "newAdminPublicKey": "GXYZ...",
  "newAdminSecretKey": "SXYZ...",
  "reason": "Annual security update",
  "multiSigRequired": true,
  "timeLockHours": 48
}
```

### Acceptance Criteria Met

✅ **Multi-sig required for admin changes**
✅ **Time-lock protection implemented**
✅ **Audit trail maintained**

## JWT Secret Rotation (legacy manual path — superseded below)

> **Superseded.** This section describes the original `JWT_SECRET` /
> `JWT_SECRET_NEW` environment-variable approach, triggered via
> `POST /api/v1/key-rotation/jwt`. It required editing env vars and a
> service restart to finalize, and the "old secret still valid" window
> was open-ended rather than time-boxed. It has been replaced by the
> automated AWS Secrets Manager rotation described in
> **[Automated Secrets Manager Rotation (JWT / Postgres / Redis)](#automated-secrets-manager-rotation-jwt--postgres--redis)**
> below. This section is kept for historical reference only — the
> `/api/v1/key-rotation/jwt` endpoint and its underlying env vars are
> deprecated and will be removed in a future release.

### Procedure

1. **Dual Secret Mode**
   - New JWT secret is added to environment
   - Both old and new secrets are accepted during transition
   - Zero-downtime authentication maintained

2. **Transition Period**
   - Default 24-hour transition period (configurable)
   - New tokens issued with new secret
   - Existing tokens remain valid until expiration

3. **Finalization**
   - After transition period, old secret is removed
   - Environment updated to use only new secret
   - System continues normal operation

### API Usage

```bash
POST /api/v1/key-rotation/jwt
{
  "newJWTSecret": "new-super-secret-key-32-chars-min",
  "reason": "Quarterly security rotation",
  "transitionPeriodHours": 24
}
```

### Acceptance Criteria Met

✅ **Zero-downtime authentication**
✅ **Two valid secrets during transition**
✅ **Gradual token migration**

## Automated Secrets Manager Rotation (JWT / Postgres / Redis)

This is the current, automated process for the three secrets that
require coordinated restarts across NestJS, the oracle, and the
frontend if handled manually: the JWT signing secret, PostgreSQL
credentials, and the Redis AUTH token. Unlike the oracle/admin
rotation above (which stays a deliberate, admin-triggered API call),
these three now rotate automatically on a schedule with no manual
steps and no restart.

### What rotates, and how

| Secret | Mechanism | Terraform resource |
|---|---|---|
| JWT signing secret | Custom Lambda, dual-secret overlap | `infra/main/secrets.tf` → `aws_lambda_function.rotate_jwt` |
| PostgreSQL credentials | AWS-managed RDS single-user rotation template (via Serverless Application Repository) | `aws_serverlessapplicationrepository_cloudformation_stack.rotate_postgres` |
| Redis AUTH token | Custom Lambda, ElastiCache `ROTATE` strategy | `aws_lambda_function.rotate_redis` |

All three follow the standard Secrets Manager four-step lifecycle
(`createSecret` → `setSecret` → `testSecret` → `finishSecret`), wired
via `aws_secretsmanager_secret_rotation` on a 30-day schedule (or
on-demand: `aws secretsmanager rotate-secret --secret-id <arn>`).

### The 15-minute JWT overlap

The JWT secret is stored as a JSON document rather than a bare
string:

```json
{ "current": "...", "previous": "...", "previous_expires_at": "2026-08-01T03:15:00Z" }
```

`createSecret` generates a new `current` value and carries the
outgoing value forward as `previous`, stamped with an expiry 15
minutes out. Tokens signed with the old secret keep validating until
that timestamp passes, which is what lets in-flight requests survive
a rotation with zero downtime.

### How the backend picks it up without restarting

`backend/src/key-rotation/secrets-refresh.service.ts`
(`SecretsRefreshService`) keeps the live JWT/Postgres/Redis values in
memory and refreshes them:

- **On `SIGHUP`** — sent as part of the Lambda's `finishSecret` step,
  or manually: `kill -HUP <pid>`.
- **On a 5-minute poll** — a fallback in case a `SIGHUP` is ever
  missed.

`backend/src/auth/jwt-rotation.strategy.ts` (`JWTRotationStrategy`)
reads from `SecretsRefreshService.getJwtVerificationSecrets()`, which
returns the current secret plus the previous one only while still
inside its 15-minute window — replacing the old
`JWT_SECRET`/`JWT_SECRET_NEW` env-var pair described above.

Oracle services use the same pattern in Python, via
`oracle/secrets_manager.py`: `start_refresh_loop()` does an initial
fetch, registers a `SIGHUP` handler, and starts a 5-minute poll
fallback thread. `verification_listener.py` calls
`secrets_manager.get_database_url()` fresh on every `psycopg2.connect()`
(never cached), and tracks a `refresh_generation` counter to detect
when the Redis AUTH token has rotated and reconnect — closing a bug
where the previous lazily-cached Redis client had no way to pick up a
rotated password short of a full process restart.

### Automated end-to-end test

`scripts/test-key-rotation-staging.sh` now includes
`test_secrets_manager_rotation()`, which:

1. Forces a rotation of each of the three secrets via
   `aws secretsmanager rotate-secret`.
2. Probes an authenticated staging endpoint continuously through the
   rotation window and fails on any dropped request.
3. Confirms the rotation Lambda reports the secret fully settled
   (no `AWSPENDING` version left).

This runs nightly via `.github/workflows/key-rotation-test.yml`
(03:00 UTC) and can be triggered manually from the Actions tab.
Required env vars: `STAGING_JWT_SECRET_ARN`, `STAGING_POSTGRES_SECRET_ARN`,
`STAGING_REDIS_SECRET_ARN`, `STAGING_API_URL`.

### One thing to know about Terraform state

RDS's built-in single-user rotation template updates the database
password directly via the RDS API — it does not go through Terraform.
That means `var.db_password` in `infra/main/variables.tf` reflects
only the *bootstrap* password from the first `terraform apply`; after
the first rotation, the real password lives in Secrets Manager, not
in Terraform state or tfvars. This is expected AWS behavior for RDS
rotation and doesn't require any Terraform changes to accommodate.

## Security Considerations

### Key Storage

- All secrets are encrypted at rest
- Environment variables are used for runtime configuration
- Backup procedures follow security best practices

### Audit Trail

- All rotation events are logged
- Database maintains rotation history
- System events are emitted for monitoring

### Access Control

- Only authorized users can initiate rotations
- Role-based access control enforced
- Multi-sig protection for critical operations

## Testing Procedures

### Staging Environment

1. **Oracle Rotation Test**
   ```bash
   # Test oracle key rotation in staging
   curl -X POST http://localhost:3001/api/v1/key-rotation/oracle \
     -H "Authorization: Bearer <token>" \
     -d '{
       "newOraclePublicKey": "GTEST...",
       "newOracleSecretKey": "STEST...",
       "reason": "Staging test rotation"
     }'
   ```

2. **Admin Rotation Test**
   ```bash
   # Test admin key rotation with time-lock
   curl -X POST http://localhost:3001/api/v1/key-rotation/admin \
     -H "Authorization: Bearer <token>" \
     -d '{
       "newAdminPublicKey": "GTEST...",
       "newAdminSecretKey": "STEST...",
       "reason": "Staging test rotation",
       "multiSigRequired": true,
       "timeLockHours": 1
     }'
   ```

3. **JWT Rotation Test**
   ```bash
   # Test JWT secret rotation
   curl -X POST http://localhost:3001/api/v1/key-rotation/jwt \
     -H "Authorization: Bearer <token>" \
     -d '{
       "newJWTSecret": "test-secret-key-32-chars-minimum",
       "reason": "Staging test rotation",
       "transitionPeriodHours": 2
     }'
   ```

### Verification Steps

1. **Monitor Rotation Status**
   ```bash
   curl -X GET http://localhost:3001/api/v1/key-rotation/<rotation-id>
   ```

2. **Verify System Operations**
   - Oracle submissions continue working
   - Admin operations function normally
   - Authentication remains valid

3. **Check Audit Logs**
   - Review rotation events
   - Verify security measures
   - Confirm system integrity

## Monitoring and Alerting

### Key Metrics

- Rotation success/failure rates
- Time taken for rotation completion
- System performance during rotation

### Alerts

- Rotation failures
- Extended rotation times
- Unusual access patterns

### Logging

- Detailed rotation logs
- Security event logging
- Performance metrics

## Emergency Procedures

### Rotation Failure

1. **Identify Issue**
   - Check rotation status
   - Review error logs
   - Verify system state

2. **Rollback Plan**
   - Restore previous keys if needed
   - Revert environment changes
   - Verify system recovery

3. **Post-Incident Review**
   - Document root cause
   - Update procedures
   - Improve monitoring

### Compromise Response

1. **Immediate Rotation**
   - Initiate emergency rotation
   - Use accelerated procedures
   - Notify security team

2. **System Hardening**
   - Review access logs
   - Update security measures
   - Enhance monitoring

## Configuration

### Environment Variables

```bash
# Oracle Configuration
ORACLE_PUBLIC_KEY=GABC...
ORACLE_SECRET_KEY=SABC...

# Admin Configuration  
ADMIN_PUBLIC_KEY=GXYZ...
ADMIN_SECRET_KEY=SXYZ...

# JWT Configuration
JWT_SECRET=original-secret-key-32-chars-minimum
JWT_SECRET_NEW=new-secret-key-32-chars-minimum  # During rotation

# Stellar Configuration
CARBON_ORACLE_CONTRACT_ID=CA...
STELLAR_NETWORK=testnet
```

### Rotation Settings

- **Default transition period**: 24 hours
- **Maximum time-lock**: 168 hours (7 days)
- **Minimum secret length**: 32 characters
- **Audit retention**: 1 year

## Conclusion

The key rotation procedures ensure secure, zero-downtime maintenance of critical system keys. Regular testing in staging environments is required before production deployment.

For questions or issues, contact the security team at security@carbonledger.com.