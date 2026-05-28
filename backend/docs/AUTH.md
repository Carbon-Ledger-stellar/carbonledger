# SEP-0030 Account Recovery

CarbonLedger supports [SEP-0030](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0030.md) — the Stellar account recovery standard — so users who lose access to their Freighter wallet can recover their CarbonLedger account without storing a password.

---

## What SEP-0030 Does

SEP-0030 lets a user register one or more **recovery servers** (trusted third parties) that can co-sign a transaction to replace the signing key on a Stellar account. The user's account is a multi-sig account where:

- **Primary signer** — the user's Freighter keypair (weight 2, threshold 2)
- **Recovery signers** — one or more SEP-0030 servers (weight 1 each)

If the primary key is lost, two recovery servers together can sign a transaction that replaces the primary signer with a new keypair.

---

## How CarbonLedger Uses It

CarbonLedger does **not** run a SEP-0030 server itself. Instead, users are encouraged to register with one or more public SEP-0030 providers before using the platform.

Recommended providers:
- [SDF Recovery Server](https://recovery.stellar.org) — operated by the Stellar Development Foundation
- [Vibrant](https://vibrant.io) — consumer-focused recovery

---

## Setup (User Steps)

### 1. Configure your Stellar account for recovery

Before registering on CarbonLedger, set up your account as a multi-sig account with at least one recovery server:

```bash
# Using Stellar CLI — add a recovery signer at weight 1
stellar account set-options \
  --source YOUR_SECRET_KEY \
  --signer-key RECOVERY_SERVER_PUBLIC_KEY \
  --signer-weight 1 \
  --master-weight 2 \
  --low-threshold 1 \
  --med-threshold 2 \
  --high-threshold 2 \
  --network testnet
```

### 2. Register with a SEP-0030 server

```http
POST https://recovery.stellar.org/accounts/{address}
Authorization: Bearer <identity-token>
Content-Type: application/json

{
  "identities": [
    {
      "role": "owner",
      "auth_methods": [
        { "type": "stellar_address", "value": "YOUR_PUBLIC_KEY" },
        { "type": "email", "value": "you@example.com" }
      ]
    }
  ]
}
```

### 3. Store your recovery server list

Keep a record of:
- The recovery server URL(s) you registered with
- The identity methods you used (email, phone, etc.)

---

## Recovery Flow (Key Lost)

1. Authenticate with your recovery server(s) using your registered identity (e.g. email OTP).
2. Each server returns a partial signature for a **replace-signer transaction**.
3. Combine signatures from enough servers to meet the account threshold.
4. Submit the transaction to Stellar — your account now has a new primary signer.
5. Log in to CarbonLedger with the new keypair using the normal challenge-response flow.

---

## CarbonLedger Auth Flow (Normal)

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
  │  { access_token,               │
  │    refresh_token }             │
  │ ◄───────────────────────────── │
  │                                │
  │  (15 min later — token expiry) │
  │                                │
  │  POST /api/v1/auth/refresh     │
  │  { refreshToken }              │
  │ ─────────────────────────────► │
  │  { access_token,               │
  │    refresh_token }             │
  │ ◄───────────────────────────── │
```

---

## Token Details

| Token | Lifetime | Secret env var |
|-------|----------|----------------|
| `access_token` | 15 min (configurable via `JWT_EXPIRY`) | `JWT_SECRET` |
| `refresh_token` | 7 days (configurable via `JWT_REFRESH_EXPIRY`) | `JWT_REFRESH_SECRET` |

Both tokens carry `{ sub: publicKey, role, type }`. The `type` claim (`"access"` / `"refresh"`) prevents a refresh token from being used as a bearer token and vice versa.

---

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `GET /auth/challenge` | 10 requests / minute / IP |
| `POST /auth/verify` | 5 requests / minute / IP |
| `POST /auth/refresh` | 10 requests / minute / IP |

Exceeding the limit returns `429 Too Many Requests`.

---

## Environment Variables

```env
JWT_SECRET=<strong-random-secret>
JWT_EXPIRY=15m
JWT_REFRESH_SECRET=<different-strong-random-secret>
JWT_REFRESH_EXPIRY=7d
```

Use separate secrets for access and refresh tokens. Generate with:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
