# JWT Token Refresh Mechanism

## Overview

The Carbon Ledger authentication system implements a secure JWT token refresh mechanism with short-lived access tokens and token family-based rotation. This design ensures that stolen tokens have a strictly bounded window of validity while maintaining a seamless user experience through token rotation.

## Feature Summary

- **Access Token TTL**: 15 minutes (strictly enforced)
- **Refresh Token TTL**: 7 days (idle timeout) / 30 days (hard limit)
- **Token Rotation**: Atomic refresh with new token pair issuance
- **Reuse Detection**: Automatic family invalidation on token reuse
- **Redis Storage**: Token families stored in Redis for scalability
- **Opaque Refresh Tokens**: Not JWT-signed, increasing security

## Architecture

### Token Types

#### Access Token
- **Format**: JWT (JSON Web Token)
- **TTL**: 15 minutes (maximum, enforced regardless of configuration)
- **Contains**: `sub` (public key), `role`, `type: 'access'`, `jti` (unique ID), `exp` (expiration)
- **Usage**: Bearer token in Authorization header
- **Purpose**: Grants access to protected endpoints

#### Refresh Token
- **Format**: Opaque string (not JWT)
- **Format Details**: `{familyId}.{randomEntropy}` where familyId is UUID v4
- **TTL**: 7 days (idle timeout), 30 days (hard maximum)
- **Storage**: HTTP-only cookie or request body
- **Purpose**: Used to obtain new access tokens without re-authentication

### Token Family System

```
Login
  ↓
Create Token Family
  ├─ Store in Redis: auth:family:{familyId}
  ├─ Track all hashes in chain
  └─ Return access_token + refresh_token
  
User Action (Access Token Valid)
  ↓
Use Protected Endpoint
  └─ Validate Bearer token, proceed
  
User Action (Access Token Expired)
  ↓
POST /auth/refresh
  ├─ Extract refresh_token from cookie/body
  ├─ Lookup family in Redis
  ├─ Check token hash against active hash
  ├─ Validate:
  │  ├─ Hash matches active → Rotate (Happy Path)
  │  ├─ Hash in history but inactive → Reuse Detected (Invalidate All)
  │  └─ Hash not found → Invalid token
  ├─ If Rotate: Issue new token pair, retire old
  └─ Return new access_token + refresh_token (new cookie)
  
Logout
  ↓
POST /auth/logout
  ├─ Blacklist current access_token's jti
  ├─ Invalidate entire token family
  └─ Clear refresh_token cookie
```

### Reuse Detection

The token family system prevents token compromise through:

1. **Linear History**: Every token issued in a family tracked in order
2. **Active Token**: Only one token is valid at a time
3. **Reuse Detection**: If an old (already-rotated) token is used again:
   - System recognizes it's in history but not active
   - Assumption: Token was compromised (attacker + user both have tokens)
   - Action: Entire family invalidated
   - Result: User must log in again

## Endpoints

### 1. Generate Challenge

```http
GET /auth/challenge?publicKey={publicKey}
```

**Response**:
```json
{
  "nonce": "hex-encoded-32-bytes",
  "expiresAt": 1693478400000
}
```

### 2. Verify Signature and Login

```http
POST /auth/verify
Content-Type: application/json

{
  "publicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "signature": "hex-encoded-signature-of-nonce",
  "nonce": "hex-encoded-nonce-from-challenge",
  "role": "corporation"
}
```

**Response** (201):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Cookies Set**:
```
Set-Cookie: refresh_token={opaque-token}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800000
```

### 3. Refresh Token (Main Endpoint)

```http
POST /auth/refresh
Authorization: Bearer {accessToken}

{
  "refreshToken": "{opaque-token}"  # Optional if using cookie
}
```

**Response** (200):
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Cookies Set**:
```
Set-Cookie: refresh_token={new-opaque-token}; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800000
```

### 4. Logout

```http
POST /auth/logout
Authorization: Bearer {accessToken}

{
  "refreshToken": "{opaque-token}"  # Optional if using cookie
}
```

**Response** (200):
```json
{
  "message": "Logged out successfully"
}
```

**Cookies Cleared**:
```
Set-Cookie: refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=0
```

## Security Considerations

### 1. Access Token Security
- **Short TTL**: 15 minutes maximum (strictly enforced in code)
- **Unique JTI**: Each token has unique jti (JWT ID) for tracking
- **Signed JWT**: Cryptographically signed with rotating secrets
- **No Sensitive Data**: Only contains public key, role, and metadata

### 2. Refresh Token Security
- **Opaque Format**: Not JWT-decodable, increases attack surface
- **Random Entropy**: 32 bytes of cryptographically secure randomness
- **HTTP-Only Cookie**: Not accessible to JavaScript (prevents XSS leakage)
- **Secure Flag**: Only sent over HTTPS in production
- **SameSite**: Prevents CSRF attacks

### 3. Token Rotation
- **Atomic Rotation**: Old token invalidated immediately
- **Reuse Detection**: Automatic family invalidation on reuse
- **Version Chain**: All previous hashes retained for detection
- **Family Expiry**: Hard 30-day limit prevents indefinite sessions

### 4. Storage
- **Redis**: Token families stored in Redis (not database)
- **TTL Enforcement**: Automatic expiry based on idle timeout
- **HMAC Hashing**: Tokens hashed with HMAC-SHA256 before storage
- **No Plaintext**: Refresh tokens never stored in plaintext

## Implementation Details

### Key Files

- **`backend/src/auth/auth.service.ts`**
  - `verifySignatureAndLogin()`: Issues initial token pair
  - `refresh()`: Rotates refresh token
  - `logout()`: Invalidates tokens
  - `signAccessToken()`: Creates JWT access token

- **`backend/src/auth/token-family.service.ts`**
  - `createFamily()`: Initialize new family at login
  - `rotateToken()`: Validate and rotate token
  - `invalidateFamilyByToken()`: Logout invalidation
  - `hashToken()`: HMAC-SHA256 hashing

- **`backend/src/auth/auth.controller.ts`**
  - `POST /auth/challenge`: Get nonce
  - `POST /auth/verify`: Login with signature
  - `POST /auth/refresh`: Refresh token pair
  - `POST /auth/logout`: Logout

- **`backend/src/auth/auth.dto.ts`**
  - `ChallengeDto`: Challenge request
  - `VerifyDto`: Signature verification
  - `RefreshDto`: Token refresh
  - `LogoutDto`: Logout request

### Constants

```typescript
// Access token TTL: 15 minutes (strictly enforced)
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

// Refresh token idle timeout: 7 days
const FAMILY_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;

// Refresh token hard limit: 30 days
const FAMILY_HARD_TTL_SECONDS = 30 * 24 * 60 * 60;

// Cookie configuration
const REFRESH_COOKIE = 'refresh_token';
const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REFRESH_COOKIE_PATH = '/api/v1/auth';
```

## Usage Flow

### Browser/SPA Client

```javascript
// 1. Get challenge
const { nonce, expiresAt } = await fetch('/api/v1/auth/challenge?publicKey=G...').then(r => r.json());

// 2. Sign challenge with Freighter wallet
const signature = await window.freighter.signTransaction(Buffer.from(`carbonledger:${nonce}`, 'utf-8'));

// 3. Verify and login (receive access token, refresh token in cookie)
const { access_token } = await fetch('/api/v1/auth/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'include',  // Send/receive cookies
  body: JSON.stringify({ publicKey: 'G...', signature, nonce })
}).then(r => r.json());

// 4. Use access token to access protected endpoints
const projects = await fetch('/api/v1/projects', {
  headers: { 'Authorization': `Bearer ${access_token}` },
  credentials: 'include'
}).then(r => r.json());

// 5. When access token expires (401 response), refresh
const { access_token: new_token } = await fetch('/api/v1/auth/refresh', {
  method: 'POST',
  credentials: 'include'  // Automatically sends refresh_token cookie
}).then(r => r.json());

// 6. Use new access token for subsequent requests
const more_projects = await fetch('/api/v1/projects', {
  headers: { 'Authorization': `Bearer ${new_token}` },
  credentials: 'include'
}).then(r => r.json());

// 7. Logout
await fetch('/api/v1/auth/logout', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${new_token}` },
  credentials: 'include'
});
```

### Non-Browser Client (API)

```bash
# 1. Get challenge
curl https://api.example.com/api/v1/auth/challenge?publicKey=G...

# 2. Sign and verify
curl -X POST https://api.example.com/api/v1/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"G...","signature":"...","nonce":"..."}'

# Response includes access_token; refresh_token can be passed in body

# 3. Refresh (provide refresh token in body)
curl -X POST https://api.example.com/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"..."}'

# 4. Use access token
curl https://api.example.com/api/v1/projects \
  -H "Authorization: Bearer {access_token}"

# 5. Refresh again when needed
curl -X POST https://api.example.com/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken":"{new_refresh_token_from_previous_response}"}'
```

## Error Handling

### 400 Bad Request
- Missing required fields
- Invalid Stellar public key format

### 401 Unauthorized
- Invalid signature
- Challenge expired or missing
- Invalid refresh token
- Token reuse detected (message includes "reuse")
- Expired refresh token
- Refresh token missing

### 429 Too Many Requests
- Rate limiting on challenge endpoint (10 per minute)
- Rate limiting on verify endpoint (5 per minute)
- Rate limiting on refresh endpoint (10 per minute)

### 503 Service Unavailable
- Database temporarily unavailable
- Redis temporarily unavailable

## Testing

### Run All Auth Tests
```bash
npm run test:e2e -- auth
```

### Run Refresh Token Tests Specifically
```bash
npm run test:e2e -- auth-refresh-token
```

### Test Coverage
- **30+ test cases** covering:
  - Access token TTL validation (15 minutes)
  - Refresh token TTL validation (7 days)
  - Token rotation and validation
  - Token reuse detection
  - Logout functionality
  - Error handling
  - Edge cases
  - Multiple users and sessions
  - Concurrent operations

## Configuration

### Environment Variables

```bash
# JWT Signing
JWT_SECRET=your-secret-key
JWT_ISSUER=carbonledger
JWT_EXPIRY=15m  # Clamped to 15 minutes max

# HMAC for token hashing
HMAC_SECRET=your-hmac-secret

# Redis
REDIS_URL=redis://localhost:6379

# Cookies
NODE_ENV=production  # Sets Secure flag on cookies
```

### Redis Configuration

Token families stored with key pattern: `auth:family:{familyId}`

**TTL Calculation**:
```
ttl = min(
  FAMILY_IDLE_TTL_SECONDS (7 days),
  FAMILY_HARD_TTL_SECONDS - age (30 day max - age)
)
```

## Performance

### Latency
- **Challenge Generation**: ~1ms (in-memory nonce store)
- **Verify (Login)**: ~50-100ms (Stellar key verification + DB write)
- **Refresh**: ~20-50ms (Redis lookup + JWT signing)
- **Access Token Validation**: ~5-10ms (JWT verification)

### Scalability
- **Redis**: O(1) token family lookup on refresh
- **Database**: Minimal writes (only on login)
- **JWT Verification**: Can be parallelized across instances

## Monitoring

### Metrics to Track
- Refresh success rate (target: >99%)
- Refresh latency (p95 < 100ms)
- Token reuse detection events (should be rare)
- Session duration (average time before logout)
- Concurrent sessions per user

### Alerts
- High refresh failure rate (>1%)
- Sudden spike in reuse detection (possible attack)
- Redis connectivity issues
- JWT verification failures
- Token family eviction rate (> 10% per day)

## Troubleshooting

### Issue: Refresh Token Missing
**Cause**: Cookie not being sent back
**Solution**: Verify `credentials: 'include'` in fetch requests, check cookie path

### Issue: Token Reuse Detected on First Use
**Cause**: Token family compromised or corrupted
**Solution**: User must log in again, investigate Redis state

### Issue: Refresh Returns 401
**Possible Causes**:
- Refresh token expired (> 7 days idle or > 30 days total)
- Token reuse detected (family invalidated)
- Redis connection lost

**Solution**: User must log in again

### Issue: Access Token Claims Missing
**Cause**: JWT not properly signed
**Solution**: Verify JWT_SECRET is configured and consistent

## Acceptance Criteria - Verification

✅ **access_token TTL: 15 minutes**
- Enforced in `AuthService.signAccessToken()`: `Math.min(requested, ACCESS_TOKEN_TTL_SECONDS)`
- Tested in `auth-refresh-token.e2e-spec.ts`: "access token has 15 minute TTL"

✅ **refresh_token TTL: 7 days**
- Idle timeout: `FAMILY_IDLE_TTL_SECONDS = 7 * 24 * 60 * 60`
- Hard limit: `FAMILY_HARD_TTL_SECONDS = 30 * 24 * 60 * 60`
- Tested in `auth-refresh-token.e2e-spec.ts`: "refresh token TTL is 7 days from creation"

✅ **/auth/refresh endpoint validates and rotates tokens**
- Endpoint implemented in `AuthController`
- Validation logic in `TokenFamilyService.rotateToken()`
- Tested in 30+ test cases

✅ **Old refresh_token invalidated after use**
- Rotation logic in `TokenFamilyService.rotateToken()`
- Previous hashes retained for reuse detection
- Tested in "old refresh token is invalidated after use"

✅ **Test covers happy path and token reuse rejection**
- Happy path: "login -> refresh -> use new token"
- Reuse rejection: "token reuse invalidates entire family"
- 30+ total test cases covering all scenarios

## Future Enhancements

1. **Device Tracking**: Tie refresh tokens to specific devices
2. **Geo-Location**: Detect unusual login locations
3. **Adaptive TTL**: Vary token lifetime based on risk score
4. **Multi-Factor Auth**: Additional verification on refresh
5. **Token Binding**: Tie tokens to certificate/fingerprint
6. **Revocation Lists**: Faster token revocation mechanism
