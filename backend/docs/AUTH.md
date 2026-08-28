# Authentication

CarbonLedger uses a **Stellar keypair challenge-response** flow for login (no passwords), short-lived JWT access tokens, and **opaque refresh tokens with family-based rotation** to prevent token theft.

---

## Table of Contents

- [Auth Flow Overview](#auth-flow-overview)
- [Token Model](#token-model)
- [Refresh Token Rotation](#refresh-token-rotation)
- [Token Family Tracking in Redis](#token-family-tracking-in-redis)
- [Reuse Detection (Theft Mitigation)](#reuse-detection-theft-mitigation)
- [Logout](#logout)
- [API Reference](#api-reference)
- [Rate Limits](#rate-limits)
- [Environment Variables](#environment-variables)
- [SEP-0030 Account Recovery](#sep-0030-account-recovery)

---

## Auth Flow Overview

```
Client                          Backend
  │                                │
  │  GET /api/v1/auth/challenge    │
  │  ?publicKey=G...               │
  │ ─────────────────────────────► │
  │  { nonce, expiresAt }          │
  │ ◄───────────────────────────── │
  │                                │
  │  sign("carbonledger:<nonce>")  │
  │  with Freighter                │
  │                                │
  │  POST /api/v1/auth/verify      │
  │  { publicKey, signature,       │
  │    nonce, role }               │
  │ ─────────────────────────────► │
  │  { access_token,               │  ← JWT (15 min)
  │    refresh_token }             │  ← opaque string (family-tracked)
  │ ◄───────────────────────────── │
  │                                │
  │  (access token expires)        │
  │                                │
  │  POST /api/v1/auth/refresh     │
  │  { refreshToken }              │
  │ ─────────────────────────────► │
  │  { access_token,               │  ← new JWT
  │    refresh_token }             │  ← NEW opaque token; old one invalidated
  │ ◄───────────────────────────── │
  │                                │
  │  POST /api/v1/auth/logout      │
  │  { refreshToken }              │
  │ ─────────────────────────────► │
  │  { message: "Logged out" }     │  ← entire family deleted
  │ ◄───────────────────────────── │
```

---

## Token Model

| Token | Type | Lifetime | Storage |
|-------|------|----------|---------|
| `access_token` | Signed JWT (`type: "access"`) | 15 min (`JWT_EXPIRY`) | Client only |
| `refresh_token` | Opaque string (`<familyId>.<random>`) | Up to 30 days | Client only; hash stored in Redis |

**Access tokens** carry `{ sub: publicKey, role, type: "access" }` and are verified by the `JwtStrategy` on every protected endpoint.

**Refresh tokens** are opaque base64url strings — they are **not** JWTs. The token embeds the `familyId` (UUID v4) as a prefix separated by `.` so the backend can look up the family in O(1) from Redis without a secondary index. The raw token value is never stored; only its HMAC-SHA256 hash is persisted.

---

## Refresh Token Rotation

Every call to `POST /api/v1/auth/refresh`:

1. Parses the `familyId` from the token prefix.
2. Loads `auth:family:{familyId}` from Redis.
3. Computes `HMAC-SHA256(rawToken)` and compares it to `activeTokenHash`.
4. On match: generates a new token, appends its hash to `family.tokens`, updates `activeTokenHash`, persists the family, and returns the new pair.
5. The **old refresh token is immediately invalidated** — presenting it again triggers reuse detection.

---

## Token Family Tracking in Redis

Each login session creates one **token family**. The family record is stored at:

```
KEY  auth:family:{familyId}
TTL  min(7-day idle window, remaining time until 30-day hard cap)
```

```jsonc
{
  "userId":          "GABC...XYZ",         // Stellar public key
  "tokens":          ["hash1", "hash2"],   // HMAC-SHA256 hashes, oldest first
  "activeTokenHash": "hash2",              // only this hash is valid for rotation
  "createdAt":       1720000000000,        // Unix ms
  "lastUsedAt":      1720001000000         // Unix ms — reset on every rotation
}
```

**TTL behaviour:**
- The TTL is refreshed to `FAMILY_IDLE_TTL_SECONDS` (7 days) on every successful rotation.
- A family that is never used expires in 7 days.
- A family in active use can survive up to 30 days (`FAMILY_HARD_TTL_SECONDS`) from creation, after which the user must log in again.

---

## Reuse Detection (Theft Mitigation)

If a previously-rotated (retired) token is presented to `/refresh`, it indicates that either:
- the client is replaying an old token (bug), or
- the token was stolen and the attacker is using the copy while the legitimate client already rotated.

**Response:** the **entire family is deleted from Redis** and a `401 Unauthorized` is returned with message `"Refresh token reuse detected — all sessions have been invalidated. Please log in again."` Both the attacker's copy and the legitimate user's current token become invalid. The user must re-authenticate.

```
Attacker           Client              Backend
    │                 │                   │
    │                 │ POST /refresh(rt1) │  ← legitimate rotation
    │                 │ ──────────────────►│
    │                 │  { rt2 }          │
    │                 │ ◄──────────────── │
    │                 │                   │
    │ POST /refresh(rt1) (stolen copy)    │  ← reuse detected
    │ ────────────────────────────────── ►│
    │  401 — family invalidated           │  ← rt1 AND rt2 are now dead
    │ ◄───────────────────────────────── │
    │                 │                   │
    │                 │ POST /refresh(rt2) │  ← legitimate user's token also dead
    │                 │ ──────────────────►│
    │                 │  401              │
    │                 │ ◄──────────────── │
```

---

## Logout

`POST /api/v1/auth/logout` accepts the current refresh token and **deletes the entire family** from Redis. All devices that share the same login session (same family) are immediately signed out.

---

## API Reference

### `GET /api/v1/auth/challenge`

**Request**
```http
GET /api/v1/auth/challenge?publicKey=GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

**Response**
```json
{
  "nonce": "a3f9...b2",
  "expiresAt": 1720005600000
}
```

---

### `POST /api/v1/auth/verify`

**Request**
```json
{
  "publicKey": "GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  "signature": "aabb...",
  "nonce": "a3f9...b2",
  "role": "project_developer"
}
```

**Response**
```json
{
  "access_token": "eyJhbGci...",
  "refresh_token": "550e8400-e29b-41d4-a716-446655440000.Zk9xY..."
}
```

---

### `POST /api/v1/auth/refresh`

**Request**
```json
{
  "refreshToken": "550e8400-e29b-41d4-a716-446655440000.Zk9xY..."
}
```

**Response (success)**
```json
{
  "access_token": "eyJhbGci...",
  "refresh_token": "550e8400-e29b-41d4-a716-446655440000.NewTokenHere..."
}
```

**Response (reuse detected — 401)**
```json
{
  "message": "Refresh token reuse detected — all sessions have been invalidated. Please log in again."
}
```

---

### `POST /api/v1/auth/logout`

**Request**
```json
{
  "refreshToken": "550e8400-e29b-41d4-a716-446655440000.Zk9xY..."
}
```

**Response**
```json
{
  "message": "Logged out successfully"
}
```

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `GET /api/v1/auth/challenge` | 10 req / min / IP |
| `POST /api/v1/auth/verify` | 5 req / min / IP |
| `POST /api/v1/auth/refresh` | 10 req / min / IP |
| `POST /api/v1/auth/logout` | 10 req / min / IP |

---

## Environment Variables

```env
# Access token signing
JWT_SECRET=<strong-random-secret-64-bytes>
JWT_EXPIRY=15m
JWT_ISSUER=carbonledger

# Legacy: no longer used for refresh tokens (kept for jwt-rotation strategy)
JWT_REFRESH_SECRET=<different-strong-random-secret>
JWT_REFRESH_EXPIRY=7d

# HMAC key for hashing refresh tokens before storage in Redis
# Defaults to JWT_SECRET if not set — set explicitly in production
HMAC_SECRET=<another-strong-random-secret-64-bytes>

# Redis connection
REDIS_URL=redis://localhost:6379
```

Generate secrets with:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## SEP-0030 Account Recovery

CarbonLedger supports [SEP-0030](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0030.md) — the Stellar account recovery standard — so users who lose access to their Freighter wallet can recover their account without a password.

CarbonLedger does **not** run a SEP-0030 server itself. Users are encouraged to register with one or more public providers before using the platform.

Recommended providers:
- [SDF Recovery Server](https://recovery.stellar.org) — operated by the Stellar Development Foundation
- [Vibrant](https://vibrant.io) — consumer-focused recovery

### Recovery Flow

1. Authenticate with recovery servers using your registered identity (e.g. email OTP).
2. Each server returns a partial signature for a replace-signer transaction.
3. Combine signatures from enough servers to meet the account's signing threshold.
4. Submit the transaction to Stellar — your account now has a new primary signer.
5. Log in to CarbonLedger with the new keypair using the normal challenge-response flow.
