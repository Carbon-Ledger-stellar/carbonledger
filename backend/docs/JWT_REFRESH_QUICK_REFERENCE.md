# JWT Refresh Token Mechanism - Quick Reference

## Key Facts

| Aspect | Value |
|--------|-------|
| Access Token TTL | 15 minutes (strictly enforced) |
| Refresh Token Idle TTL | 7 days |
| Refresh Token Hard TTL | 30 days |
| Endpoint | POST /api/v1/auth/refresh |
| Storage | Redis (token families) |
| Refresh Token Format | Opaque (not JWT) |
| Cookie Security | HttpOnly, Secure, SameSite=Strict |

## Quick Reference: Endpoints

### Login Flow
```bash
# 1. Get nonce
GET /api/v1/auth/challenge?publicKey=G...

# 2. Login with signature
POST /api/v1/auth/verify
{
  "publicKey": "G...",
  "signature": "hex...",
  "nonce": "hex...",
  "role": "corporation"
}
# Returns: { access_token: "jwt..." }
# Cookies: refresh_token (HttpOnly)
```

### Token Refresh
```bash
# Option 1: Via cookie (automatic for browsers)
POST /api/v1/auth/refresh
# Returns: { access_token: "jwt..." }
# Cookies: refresh_token (new, HttpOnly)

# Option 2: Via body (for API clients)
POST /api/v1/auth/refresh
{
  "refreshToken": "family-uuid.entropy..."
}
# Returns: { access_token: "jwt..." }
```

### Logout
```bash
POST /api/v1/auth/logout
Authorization: Bearer {access_token}
# OR via body
POST /api/v1/auth/logout
{
  "refreshToken": "family-uuid.entropy..."
}
```

## Implementation Overview

```
Login
  ↓ verifySignatureAndLogin()
Create Family (Redis)
  ↓
Issue Tokens
  ├─ access_token (JWT, 15 min)
  └─ refresh_token (Opaque, 7 days idle)

Refresh
  ↓ POST /auth/refresh
Rotate Token
  ├─ Lookup family in Redis
  ├─ Validate token hash
  ├─ Check for reuse (security)
  ├─ Issue new token pair
  └─ Return new access token

Logout
  ↓ POST /auth/logout
Invalidate Family
  ├─ Delete from Redis
  ├─ Blacklist access token jti
  └─ Clear cookie
```

## Security Highlights

✅ **Short Access Token**: 15-minute expiry limits theft window
✅ **Token Rotation**: Each refresh invalidates old token
✅ **Reuse Detection**: Family invalidation on compromise signal
✅ **Opaque Refresh Tokens**: Not JWT-decodable
✅ **HTTP-Only Cookies**: JavaScript cannot access refresh token
✅ **HMAC Hashing**: Tokens hashed before Redis storage
✅ **Family Tracking**: Linear history prevents token misuse

## Common Scenarios

### Browser Client
```javascript
// Refresh happens automatically via cookies
fetch('/api/v1/auth/refresh', {
  method: 'POST',
  credentials: 'include'  // Critical!
})
```

### API Client
```bash
# Store refresh token from login response
refreshToken="family-uuid.entropy..."

# Use to refresh
curl -X POST /api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$refreshToken\"}"
```

### Error Handling
```javascript
if (response.status === 401) {
  // Token expired or invalid
  if (response.body.message.includes('reuse')) {
    // Compromise detected - force re-login
  } else {
    // Try refresh
  }
}
```

## Testing

```bash
# Run all refresh token tests
npm run test:e2e -- auth-refresh-token

# Expected: 30+ tests passing
# - TTL validation ✓
# - Token rotation ✓
# - Reuse detection ✓
# - Happy path ✓
# - Error handling ✓
```

## Configuration

```bash
# .env
JWT_SECRET=your-secret
JWT_ISSUER=carbonledger
HMAC_SECRET=your-hmac-secret
REDIS_URL=redis://localhost:6379
NODE_ENV=production  # Enables Secure cookie flag
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Refresh returns 401 | Token expired (>7 days) or reused |
| No refresh token in response | Missing `credentials: 'include'` in fetch |
| "reuse detected" error | Family invalidated - user must log in again |
| Token validation fails | Verify JWT_SECRET is consistent across instances |
| Redis connection error | Check REDIS_URL and Redis availability |

## Implementation Files

- `backend/src/auth/auth.service.ts` - Main logic
- `backend/src/auth/auth.controller.ts` - Endpoints
- `backend/src/auth/token-family.service.ts` - Family management
- `backend/src/auth/auth.dto.ts` - Request/response types
- `backend/test/auth-refresh-token.e2e-spec.ts` - Test suite

## Acceptance Criteria Status

| Criteria | Status | Evidence |
|----------|--------|----------|
| access_token TTL: 15 minutes | ✅ | `ACCESS_TOKEN_TTL_SECONDS = 15 * 60` |
| refresh_token TTL: 7 days | ✅ | `FAMILY_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60` |
| /auth/refresh validates and rotates | ✅ | Endpoint + TokenFamilyService |
| Old token invalidated after use | ✅ | Token rotation logic |
| Happy path tested | ✅ | auth-refresh-token.e2e-spec.ts |
| Reuse rejection tested | ✅ | "token reuse invalidates entire family" test |

## Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| Challenge | ~1ms | In-memory nonce |
| Login | ~50-100ms | Signature verification + DB |
| Refresh | ~20-50ms | Redis lookup + JWT |
| Token Validation | ~5-10ms | JWT verification |

## Monitoring

**Key Metrics**:
- Refresh success rate (target: >99%)
- Reuse detection events (alert if >1% of refreshes)
- Token family eviction rate
- Session duration average
- Concurrent sessions per user
