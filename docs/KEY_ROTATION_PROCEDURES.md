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

## JWT Secret Rotation

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
