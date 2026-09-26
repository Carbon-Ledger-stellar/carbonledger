# Methodology-Specific Monitoring Data Schema Versioning

## Overview

The oracle bridge accepts monitoring data submissions for multiple carbon methodologies. Each methodology has a defined JSON Schema that specifies the required fields, optional fields, field types, and value constraints. Submissions are validated against the pinned schema version for their methodology before acceptance.

## Supported Methodologies

| Methodology | Version | Description |
|-------------|---------|-------------|
| REDD+ | 1.0.0 | Reducing Emissions from Deforestation and Forest Degradation |
| Clean Cookstoves | 1.0.0 | Clean cooking stove deployment and usage monitoring |
| Improved Forest Management | 1.0.0 | Improved forest management practices monitoring |
| Renewable Energy | 1.0.0 | Renewable energy project monitoring and verification |

## Schema Structure

Each methodology schema defines:

- **required_fields**: Fields that must be present in every submission.
- **optional_fields**: Fields that may be present but are not required.
- **field_types**: Expected type for each field (`string`, `integer`, `number`, `boolean`).
- **constraints**: Value constraints (min, max, exclusive_min) for numeric fields.

## Schema Versioning Rules

### Version Format

Schemas follow semantic versioning: `MAJOR.MINOR.PATCH` (e.g., `1.0.0`).

### Backward-Compatible Changes (PATCH)

- Adding new optional fields
- Relaxing constraints (e.g., increasing a max value)
- Adding new field type variants

These changes increment the PATCH version and are automatically accepted for submissions using the previous version.

### Backward-Incompatible Changes (MINOR)

- Removing fields
- Changing field types
- Adding new required fields
- Tightening constraints

These changes require a new MINOR version. Submissions using the old version continue to be validated against the old schema.

### Major Version Changes

- Complete schema redesign
- Not automatically backward-compatible
- Requires explicit migration of all submissions

## Schema Registry

The schema registry is stored in PostgreSQL in the `methodology_schemas` table:

```sql
CREATE TABLE methodology_schemas (
    id              SERIAL PRIMARY KEY,
    methodology     VARCHAR(100) NOT NULL,
    version         INTEGER      NOT NULL,
    schema_name     VARCHAR(200) NOT NULL,
    schema_body     JSONB        NOT NULL,
    backward_compat BOOLEAN      NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      VARCHAR(100) DEFAULT 'system',
    UNIQUE (methodology, version)
);
```

## Validation in verification_listener.py

The `VerificationListener` class validates each verification record against its methodology schema before processing:

1. The methodology is extracted from the verification record.
2. The schema version is determined (from the record's `schema_version` field, or the latest version for the methodology).
3. The record is validated against the schema:
   - All required fields must be present.
   - All fields must have the correct type.
   - All constraint values must be satisfied.
4. If validation fails, the record is rejected and an error is logged.
5. If validation succeeds, the record is processed normally.

### Environment Variable

- `SCHEMA_VALIDATION_ENABLED` — Set to `false` to disable schema validation (default: `true`).

## On-Chain Submission

Every on-chain monitoring data submission includes the `schema_version` used for validation. This allows the smart contract to verify that the data structure matches the expected schema for the methodology.

The schema version is included in the `MonitoringData` struct as part of the submission metadata.

## Schema Evolution Example

### Adding a New Optional Field (Backward-Compatible)

```json
{
  "schema_version": "1.1.0",
  "methodology": "REDD+",
  "required_fields": [...],
  "optional_fields": [..., "new_optional_field"],
  "field_types": { ..., "new_optional_field": "string" },
  "constraints": { ... }
}
```

### Adding a New Required Field (Backward-Incompatible)

```json
{
  "schema_version": "1.1.0",
  "methodology": "REDD+",
  "required_fields": [..., "new_required_field"],
  "optional_fields": [...],
  "field_types": { ..., "new_required_field": "integer" },
  "constraints": { ..., "new_required_field": {"min": 0} }
}
```

This requires a new MINOR version because existing submissions without `new_required_field` would fail validation.

## Database Migration

To initialize the schema registry in the database:

```bash
python3 -c "from schema_registry import init_schema_registry; init_schema_registry()"
```

This creates the `methodology_schemas` table and registers all built-in methodology schemas.