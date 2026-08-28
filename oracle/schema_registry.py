"""
Methodology Schema Registry for Oracle Monitoring Data.

Each carbon methodology has a versioned JSON Schema that defines
the required and optional fields for monitoring data submissions.
Submissions are validated against the pinned schema version for
their methodology before being accepted.

Schema Evolution Rules
----------------------
- Backward-compatible changes (adding optional fields, relaxing
  constraints) increment the patch version (e.g. 1.0.0 → 1.1.0).
- Backward-incompatible changes (removing fields, changing types,
  adding required fields) require a new minor version (e.g. 1.0.0 → 1.1.0).
- Major version changes (e.g. 1.x → 2.0.0) indicate a complete
  schema redesign and are not automatically backward-compatible.
- Every submission must include the schema_version used for validation.
- The schema_version is included in every on-chain monitoring data
  submission so that the contract can verify the data structure.

Supported Methodologies
------------------------
1. REDD+ (Reducing Emissions from Deforestation and Forest Degradation)
2. Clean Cookstoves
3. Improved Forest Management (IFM)
4. Renewable Energy (RE)
"""

import json
import os
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

import psycopg2
import psycopg2.extras

logger = logging.getLogger(__name__)

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ---------------------------------------------------------------------------
# Methodology Schema Definitions
# ---------------------------------------------------------------------------

REDD_PLUS_SCHEMA_V1 = {
    "schema_version": "1.0.0",
    "methodology": "REDD+",
    "description": "Reducing Emissions from Deforestation and Forest Degradation",
    "required_fields": [
        "project_id",
        "period",
        "tonnes_verified",
        "methodology_score",
        "satellite_cid",
        "forest_area_ha",
        "baseline_emissions",
        "actual_emissions",
    ],
    "optional_fields": [
        "country",
        "region",
        "project_type",
        "verification_body",
        "vintage_year",
    ],
    "field_types": {
        "project_id": "string",
        "period": "string",
        "tonnes_verified": "number",
        "methodology_score": "integer",
        "satellite_cid": "string",
        "forest_area_ha": "number",
        "baseline_emissions": "number",
        "actual_emissions": "number",
        "country": "string",
        "region": "string",
        "project_type": "string",
        "verification_body": "string",
        "vintage_year": "integer",
    },
    "constraints": {
        "tonnes_verified": {"min": 0, "exclusive_min": True},
        "methodology_score": {"min": 0, "max": 100},
        "forest_area_ha": {"min": 0},
        "baseline_emissions": {"min": 0},
        "actual_emissions": {"min": 0},
    },
}

CLEAN_COOKSTOVES_SCHEMA_V1 = {
    "schema_version": "1.0.0",
    "methodology": "Clean Cookstoves",
    "description": "Clean cooking stove deployment and usage monitoring",
    "required_fields": [
        "project_id",
        "period",
        "tonnes_verified",
        "methodology_score",
        "satellite_cid",
        "stoves_deployed",
        "households_reached",
        "fuel_type",
    ],
    "optional_fields": [
        "country",
        "region",
        "project_type",
        "verification_body",
        "vintage_year",
        "baseline_fuel_consumption",
    ],
    "field_types": {
        "project_id": "string",
        "period": "string",
        "tonnes_verified": "number",
        "methodology_score": "integer",
        "satellite_cid": "string",
        "stoves_deployed": "integer",
        "households_reached": "integer",
        "fuel_type": "string",
        "country": "string",
        "region": "string",
        "project_type": "string",
        "verification_body": "string",
        "vintage_year": "integer",
        "baseline_fuel_consumption": "number",
    },
    "constraints": {
        "tonnes_verified": {"min": 0, "exclusive_min": True},
        "methodology_score": {"min": 0, "max": 100},
        "stoves_deployed": {"min": 1},
        "households_reached": {"min": 1},
    },
}

IMPROVED_FOREST_MANAGEMENT_SCHEMA_V1 = {
    "schema_version": "1.0.0",
    "methodology": "Improved Forest Management",
    "description": "Improved forest management practices monitoring",
    "required_fields": [
        "project_id",
        "period",
        "tonnes_verified",
        "methodology_score",
        "satellite_cid",
        "forest_area_ha",
        "baseline_carbon_stock",
        "current_carbon_stock",
        "management_activity",
    ],
    "optional_fields": [
        "country",
        "region",
        "project_type",
        "verification_body",
        "vintage_year",
        "forest_type",
        "rotation_period_years",
    ],
    "field_types": {
        "project_id": "string",
        "period": "string",
        "tonnes_verified": "number",
        "methodology_score": "integer",
        "satellite_cid": "string",
        "forest_area_ha": "number",
        "baseline_carbon_stock": "number",
        "current_carbon_stock": "number",
        "management_activity": "string",
        "country": "string",
        "region": "string",
        "project_type": "string",
        "verification_body": "string",
        "vintage_year": "integer",
        "forest_type": "string",
        "rotation_period_years": "integer",
    },
    "constraints": {
        "tonnes_verified": {"min": 0, "exclusive_min": True},
        "methodology_score": {"min": 0, "max": 100},
        "forest_area_ha": {"min": 0},
        "baseline_carbon_stock": {"min": 0},
        "current_carbon_stock": {"min": 0},
    },
}

RENEWABLE_ENERGY_SCHEMA_V1 = {
    "schema_version": "1.0.0",
    "methodology": "Renewable Energy",
    "description": "Renewable energy project monitoring and verification",
    "required_fields": [
        "project_id",
        "period",
        "tonnes_verified",
        "methodology_score",
        "satellite_cid",
        "energy_type",
        "capacity_mw",
        "energy_generated_mwh",
    ],
    "optional_fields": [
        "country",
        "region",
        "project_type",
        "verification_body",
        "vintage_year",
        "grid_connection_type",
        "emission_factor",
    ],
    "field_types": {
        "project_id": "string",
        "period": "string",
        "tonnes_verified": "number",
        "methodology_score": "integer",
        "satellite_cid": "string",
        "energy_type": "string",
        "capacity_mw": "number",
        "energy_generated_mwh": "number",
        "country": "string",
        "region": "string",
        "project_type": "string",
        "verification_body": "string",
        "vintage_year": "integer",
        "grid_connection_type": "string",
        "emission_factor": "number",
    },
    "constraints": {
        "tonnes_verified": {"min": 0, "exclusive_min": True},
        "methodology_score": {"min": 0, "max": 100},
        "capacity_mw": {"min": 0},
        "energy_generated_mwh": {"min": 0},
    },
}

# Registry of all methodology schemas
METHODLOGY_SCHEMAS: Dict[str, Dict[str, Any]] = {
    "REDD+": {
        "1.0.0": REDD_PLUS_SCHEMA_V1,
    },
    "Clean Cookstoves": {
        "1.0.0": CLEAN_COOKSTOVES_SCHEMA_V1,
    },
    "Improved Forest Management": {
        "1.0.0": IMPROVED_FOREST_MANAGEMENT_SCHEMA_V1,
    },
    "Renewable Energy": {
        "1.0.0": RENEWABLE_ENERGY_SCHEMA_V1,
    },
}


def get_methodology_schemas() -> Dict[str, Dict[str, Any]]:
    """Return the full methodology schema registry."""
    return METHODLOGY_SCHEMAS


def get_schema(methodology: str, version: str) -> Optional[Dict[str, Any]]:
    """
    Retrieve a specific methodology schema by name and version.

    Args:
        methodology: The methodology name (e.g. "REDD+").
        version: The schema version string (e.g. "1.0.0").

    Returns:
        The schema dict if found, None otherwise.
    """
    method_schemas = METHODLOGY_SCHEMAS.get(methodology)
    if method_schemas is None:
        return None
    return method_schemas.get(version)


def get_latest_schema_version(methodology: str) -> Optional[str]:
    """
    Return the latest (highest) version string for a methodology.

    Args:
        methodology: The methodology name.

    Returns:
        The latest version string, or None if the methodology is unknown.
    """
    method_schemas = METHODLOGY_SCHEMAS.get(methodology)
    if method_schemas is None:
        return None
    return max(method_schemas.keys())


def validate_submission(
    data: Dict[str, Any],
    methodology: str,
    schema_version: str,
) -> Dict[str, Any]:
    """
    Validate a monitoring data submission against a methodology schema.

    Checks:
    1. The methodology is known.
    2. The schema version exists for that methodology.
    3. All required fields are present.
    4. All fields have the correct type.
    5. All constraint values are satisfied.

    Args:
        data: The submission data dict.
        methodology: The methodology name.
        schema_version: The schema version to validate against.

    Returns:
        A dict with "valid" (bool) and "errors" (list of str).

    Raises:
        ValueError: If the methodology or schema version is unknown.
    """
    schema = get_schema(methodology, schema_version)
    if schema is None:
        raise ValueError(
            f"Unknown methodology '{methodology}' or schema version '{schema_version}'"
        )

    errors: List[str] = []

    # Check required fields
    for field in schema["required_fields"]:
        if field not in data:
            errors.append(f"Missing required field: {field}")

    # Check field types
    for field, value in data.items():
        expected_type = schema["field_types"].get(field)
        if expected_type is None:
            # Unknown field — not an error (extra fields are allowed)
            continue
        if not _check_type(value, expected_type):
            errors.append(
                f"Field '{field}' has type {type(value).__name__}, expected {expected_type}"
            )

    # Check constraints
    for field, constraint in schema.get("constraints", {}).items():
        if field not in data:
            continue
        value = data[field]
        if not isinstance(value, (int, float)):
            continue
        if "min" in constraint and value < constraint["min"]:
            errors.append(
                f"Field '{field}' value {value} is below minimum {constraint['min']}"
            )
        if "max" in constraint and value > constraint["max"]:
            errors.append(
                f"Field '{field}' value {value} exceeds maximum {constraint['max']}"
            )
        if constraint.get("exclusive_min") and value <= constraint["min"]:
            errors.append(
                f"Field '{field}' value {value} must be strictly greater than {constraint['min']}"
            )

    return {"valid": len(errors) == 0, "errors": errors}


def _check_type(value: Any, expected_type: str) -> bool:
    """Check if a value matches the expected type string."""
    type_map = {
        "string": str,
        "integer": int,
        "number": (int, float),
        "boolean": bool,
    }
    expected = type_map.get(expected_type)
    if expected is None:
        return True
    # integer is a subtype of number, but not vice versa
    if expected_type == "integer" and isinstance(value, bool):
        return False
    if expected_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return isinstance(value, expected)


def register_schema_in_db(schema: Dict[str, Any]) -> None:
    """
    Register a methodology schema in the PostgreSQL schema registry.

    Args:
        schema: The schema dict to register.
    """
    if not DATABASE_URL:
        logger.warning("DATABASE_URL not configured — skipping DB schema registration")
        return

    try:
        with psycopg2.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO methodology_schemas
                        (methodology, version, schema_name, schema_body, backward_compat)
                    VALUES (%s, %s, %s, %s, %s)
                    ON CONFLICT (methodology, version)
                    DO UPDATE SET
                        schema_body = EXCLUDED.schema_body,
                        backward_compat = EXCLUDED.backward_compat,
                        created_by = 'system_update'
                    """,
                    (
                        schema["methodology"],
                        int(schema["schema_version"].split(".")[0]),
                        schema["methodology"],
                        json.dumps(schema),
                        True,
                    ),
                )
                conn.commit()
        logger.info(
            "Registered schema for methodology=%s version=%s in DB",
            schema["methodology"],
            schema["schema_version"],
        )
    except Exception as e:
        logger.error("Failed to register schema in DB: %s", e)


def init_schema_registry() -> None:
    """
    Initialize the schema registry in PostgreSQL.

    Creates the methodology_schemas table and registers all
    built-in methodology schemas.
    """
    if not DATABASE_URL:
        logger.warning("DATABASE_URL not configured — skipping schema registry init")
        return

    try:
        with psycopg2.connect(DATABASE_URL) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS methodology_schemas (
                        id              SERIAL PRIMARY KEY,
                        methodology     VARCHAR(100) NOT NULL,
                        version         INTEGER      NOT NULL,
                        schema_name     VARCHAR(200) NOT NULL,
                        schema_body     JSONB        NOT NULL,
                        backward_compat BOOLEAN      NOT NULL DEFAULT true,
                        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
                        created_by      VARCHAR(100) DEFAULT 'system',
                        UNIQUE (methodology, version)
                    )
                    """
                )
                conn.commit()

        # Register all built-in schemas
        for methodology, versions in METHODLOGY_SCHEMAS.items():
            for version_str, schema in versions.items():
                register_schema_in_db(schema)

        logger.info("Schema registry initialized with %d methodologies", len(METHODLOGY_SCHEMAS))
    except Exception as e:
        logger.error("Failed to initialize schema registry: %s", e)


def get_schema_version_for_submission(
    methodology: str,
    data: Dict[str, Any],
) -> str:
    """
    Determine the schema version to use for a submission.

    If the submission data includes a "schema_version" key, use that.
    Otherwise, use the latest version for the methodology.

    Args:
        methodology: The methodology name.
        data: The submission data dict.

    Returns:
        The schema version string to validate against.
    """
    if "schema_version" in data:
        return str(data["schema_version"])
    return get_latest_schema_version(methodology) or "1.0.0"