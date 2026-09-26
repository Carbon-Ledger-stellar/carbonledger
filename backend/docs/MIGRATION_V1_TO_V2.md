# API v1 → v2 Migration Guide

## Overview

CarbonLedger API v2 is a backwards-compatible evolution of v1. The same core business logic
runs on both versions; v2 adds richer response shapes and new read-only endpoints without
removing anything from v1.

**v1 sunset date: 1 January 2027**

All v1 responses include a `Sunset` header with this date. Plan your migration before then.

---

## URL Structure

| Version | Base URL              |
|---------|-----------------------|
| v1      | `/api/v1/<resource>`  |
| v2      | `/api/v2/<resource>`  |

Simply change the version segment in your URL to migrate. No auth changes are required.

---

## Deprecation Headers (v1 only)

Every v1 response includes the following headers:

```
Deprecation: true
Sunset: Thu, 01 Jan 2027 00:00:00 GMT
Link: <https://api.carbonledger.io/api/v2/...>; rel="successor-version",
      <https://api.carbonledger.io/docs/migration/v1-to-v2>; rel="deprecation"
X-API-Deprecated: true
X-API-Sunset: Thu, 01 Jan 2027 00:00:00 GMT
X-API-Migration-Guide: https://api.carbonledger.io/docs/migration/v1-to-v2
X-API-Version: 1
```

v2 responses only include `X-API-Version: 2`.

---

## What Changed in v2

### Credits

| Endpoint                     | v1 behaviour                        | v2 behaviour                                    |
|------------------------------|-------------------------------------|-------------------------------------------------|
| `GET /credits/batch/:id`     | Returns batch object                | + adds `provenanceUrl` field (convenience link) |
| `GET /credits/lookup/:serial`| Returns credit summary              | + includes full `provenance` object by default  |
| `POST /credits/mint`         | Unchanged                           | Unchanged                                       |
| `POST /credits/retire`       | Unchanged                           | Unchanged                                       |

#### v1 batch response
```json
{
  "batchId": "BATCH-001",
  "projectId": "PROJ-001",
  "amount": 100,
  "vintageYear": 2023
}
```

#### v2 batch response
```json
{
  "batchId": "BATCH-001",
  "projectId": "PROJ-001",
  "amount": 100,
  "vintageYear": 2023,
  "provenanceUrl": "https://api.carbonledger.io/api/v2/credits/provenance/1000",
  "_version": 2
}
```

---

### Marketplace

| Endpoint                          | v1 behaviour              | v2 behaviour                                           |
|-----------------------------------|---------------------------|--------------------------------------------------------|
| `GET /marketplace/listings`       | Returns listings array    | + adds `_version: 2` to envelope                       |
| `POST /marketplace/purchase`      | Returns purchase receipt  | + adds `settledAt` ISO-8601 timestamp to receipt       |
| All other marketplace endpoints   | Unchanged                 | Unchanged                                              |

---

### Projects

| Endpoint            | v1 behaviour          | v2 behaviour                         |
|---------------------|-----------------------|--------------------------------------|
| `GET /projects/:id` | Returns project object| + adds `_version: 2` metadata field  |
| All other endpoints | Unchanged             | Unchanged                            |

---

## Response Shape Conventions in v2

All v2 responses include a `_version: 2` field on the top-level object. This is an informational
field only — it does not affect business logic and can be safely ignored.

---

## Migration Checklist

- [ ] Update all base URLs from `/api/v1/` → `/api/v2/`
- [ ] If you parse `GET /credits/batch/:id`, note the new `provenanceUrl` field (additive, safe to ignore)
- [ ] If you parse `GET /credits/lookup/:serial`, note the new `provenance` nested object (additive)
- [ ] If you parse `POST /marketplace/purchase`, note the new `settledAt` field (additive)
- [ ] Remove any logic that explicitly handles `Deprecation`/`Sunset` headers for v2 calls
- [ ] Update OpenAPI client generation to point to the v2 spec

---

## No Breaking Changes

The following have **not** changed between v1 and v2:

- Authentication (JWT + Stellar keypair) — identical
- All request body shapes — identical
- Validation rules — identical
- Error response format — identical (`400` + error catalog codes)
- HTTP status codes — identical
- Rate limits — identical
- Roles and permissions — identical

---

## Support

Questions? Open a GitHub issue or email api-support@carbonledger.io.

For the full OpenAPI spec see `/api/v2/docs` (coming soon) or the
[OpenAPI JSON](../docs/openapi.json).
