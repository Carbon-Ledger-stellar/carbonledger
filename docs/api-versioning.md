# CarbonLedger API Versioning & Deprecation Policy

## Current version

All API routes are served under the `/api/v1/` path prefix.

Clients may also signal the desired version via the request header:

```
Accept-Version: 1
```

If the header is omitted the request is routed to the current stable version (v1).

## Version lifecycle

| Stage | Duration | What happens |
|-------|----------|--------------|
| **Active** | Indefinite | Fully supported; breaking changes are never made |
| **Deprecated** | Minimum 6 months | Still functional; every response includes `Deprecation: true` and `Sunset: <date>` headers |
| **Sunset** | — | Version removed; requests return `410 Gone` |

## What constitutes a breaking change

- Removing or renaming an endpoint
- Removing or renaming a required request field
- Changing the type of a response field
- Changing HTTP status codes for existing success paths
- Removing enum values from existing fields

Non-breaking changes (additions of optional fields, new endpoints, new enum values) are made in-place without a version bump.

## Introducing a new version

1. A new version (e.g. v2) is introduced by adding a second global prefix **and** enabling `VersioningType.HEADER` with `Accept-Version: 2`.
2. The previous version enters **Deprecated** status on the same day.
3. `Deprecation` and `Sunset` response headers are added to all v1 responses.
4. After the 6-month minimum window the old version is removed.

## Response headers during deprecation

```
Deprecation: true
Sunset: Sat, 01 Jan 2028 00:00:00 GMT
Link: <https://docs.carbonledger.io/api/v2>; rel="successor-version"
```

## OpenAPI spec

The spec is generated at `docs/openapi.json` and reflects the current stable version.
Run `npm run export:openapi` from the `backend/` directory to regenerate it.
