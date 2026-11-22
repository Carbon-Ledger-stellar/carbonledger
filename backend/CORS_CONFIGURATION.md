# CORS Configuration

## Overview

The API is configured with Cross-Origin Resource Sharing (CORS) to allow requests from the frontend application. This document explains the CORS setup and how to configure it for different environments.

**Issue Reference**: #1461

## Configuration

CORS is configured in `src/common/cors.config.ts` and applied from `src/main.ts` to the entire Nest application:

### Allowed Origins

Origins are controlled by environment variables:

- **`CORS_ORIGINS`** (required outside local development) — Comma-separated list of explicit allowed origins
  ```bash
  CORS_ORIGINS="https://carbon-ledger.com,https://staging.carbon-ledger.com"
  ```

- **Development fallback** — `FRONTEND_URL`, then `http://localhost:3000`, is used only when `CORS_ORIGINS` is absent outside production.
  ```bash
  FRONTEND_URL="https://carbon-ledger.com"
  ```

Origins must include their scheme and host (and optional port), for example `https://app.example.com` or `http://localhost:3000`. Wildcards are rejected in every environment and production fails startup when `CORS_ORIGINS` is missing, invalid, or contains `*`.

### Allowed Methods

The following HTTP methods are permitted:
- `GET`, `HEAD` — Reading data
- `POST` — Creating resources
- `PUT`, `PATCH` — Updating resources
- `DELETE` — Removing resources
- `OPTIONS` — Preflight requests

### Allowed Headers

The following request headers are permitted:
- `Content-Type` — Request body format (JSON, form-data, etc.)
- `Authorization` — Bearer tokens and API keys
- `X-Requested-With` — AJAX request indicator
- `Idempotency-Key` — Transaction safety
- `X-Correlation-ID` — Request tracing

### Exposed Headers

The following response headers are accessible to the frontend:
- `X-Correlation-ID` — Request trace ID for debugging
- `X-RateLimit-Remaining` — Remaining API calls before rate limit

### Credentials

Credentials are enabled (`credentials: true`), allowing:
- HTTP-only cookies (session tokens)
- Authorization headers (JWT tokens)
- Custom auth headers

### Preflight Caching

Preflight (`OPTIONS`) requests are cached for **24 hours** to reduce latency and server load.

## Environment Setup

### Development

```bash
# .env.local or .env
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
CORS_ORIGINS=http://localhost:3000
```

### Staging

```bash
# .env.staging
NODE_ENV=staging
CORS_ORIGINS="https://staging.carbon-ledger.com,http://localhost:3000"
```

### Production

```bash
# .env.production
NODE_ENV=production
CORS_ORIGINS="https://carbon-ledger.com"
```

## Frontend Integration

### Making Authenticated Requests

```typescript
// Include credentials for cookie-based sessions
fetch('https://api.carbon-ledger.com/api/v1/projects', {
  credentials: 'include',  // Sends cookies
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json',
    'X-Correlation-ID': '<trace-id>'  // Optional
  }
})
```

### Marketplace Transactions with Freighter

```typescript
// POST order with Freighter-signed transaction
fetch('https://api.carbon-ledger.com/api/v1/marketplace/orders', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Authorization': 'Bearer <freighter-token>',
    'Content-Type': 'application/json',
    'Idempotency-Key': '<unique-id>'  // Prevents double-submission
  },
  body: JSON.stringify({ credits: 100, price: '50.00' })
})
```

## Security Considerations

1. **Strict Origin Checking** — Only whitelisted origins are allowed
2. **Credentials Gating** — Credentials require matching origin
3. **Preflight Validation** — Complex requests validated via OPTIONS first
4. **HTTPS Enforcement** — Production uses HSTS headers

## Troubleshooting

### CORS Error: Origin Not Allowed

**Issue**: Browser blocks request with CORS error

**Solution**: Add your origin to `CORS_ORIGINS`
```bash
CORS_ORIGINS="https://your-domain.com,https://existing-domain.com"
```

Do not use `*`, especially with credentials enabled. A production process with a missing or invalid allowlist intentionally fails during startup rather than running with an unsafe policy.

### Preflight Timeout

**Issue**: OPTIONS requests timeout or fail

**Solution**: Check network/proxy configuration; preflight caching reduces this issue

### Credentials Not Sent

**Issue**: Cookies/auth headers not included in request

**Solution**: Use `credentials: 'include'` in fetch options or `withCredentials: true` in XHR

## Testing CORS

### Using curl

```bash
# Preflight request
curl -i -X OPTIONS https://api.carbon-ledger.com/api/v1/projects \
  -H "Origin: https://carbon-ledger.com" \
  -H "Access-Control-Request-Method: POST"

# Actual request
curl -i https://api.carbon-ledger.com/api/v1/projects \
  -H "Origin: https://carbon-ledger.com" \
  -H "Authorization: Bearer <token>"
```

### Using browser DevTools

1. Open browser DevTools → Network tab
2. Make a cross-origin fetch request
3. Check response headers for `Access-Control-Allow-*`

## Related Issues

- #1020 — API Request Logging and Monitoring
- #1025 — Project Browser with Filters
- #1026 — Marketplace Trading Interface

## References

- [MDN CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [NestJS CORS](https://docs.nestjs.com/techniques/cors)
- [Stellar Freighter Wallet](https://developers.stellar.org/tools/wallets/freighter)
