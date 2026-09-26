"""Consolidate and update openapi.yaml with all current REST endpoints, serve an
interactive Swagger UI at /api/docs, and generate an up-to-date Postman collection.

This generator is the single source of truth for the committed API documentation
artifacts. It emits a consolidated OpenAPI 3.1 specification
(docs/api/openapi.yaml and docs/api/openapi.json), an up-to-date Postman
Collection v2.1 (docs/api/carbonledger.postman_collection.json), and refreshes
the legacy docs/openapi.json.

Run from backend/:  python3 scripts/generate_openapi.py

CI (.github/workflows/openapi.yml) regenerates these artifacts with this same
script and fails on any drift, so the committed spec always reflects the current
REST endpoint surface. The interactive Swagger UI is served by the NestJS backend
at /api/docs (see backend/src/main.ts).


"""
import json
import os

# ---------------------------------------------------------------------------
# Reusable component schemas
# ---------------------------------------------------------------------------
SCHEMAS = {
    "Ok": {
        "type": "object",
        "description": "Generic success payload. Shape varies per endpoint.",
        "additionalProperties": True,
    },
    "Error": {
        "type": "object",
        "required": ["error"],
        "properties": {
            "error": {
                "type": "object",
                "required": ["code", "message"],
                "properties": {
                    "code": {"type": "integer", "description": "Machine-readable CarbonError code"},
                    "name": {"type": "string"},
                    "message": {"type": "string"},
                },
            }
        },
        "examples": {
            "notFound": {"value": {"error": {"code": 1, "name": "ProjectNotFound", "message": "Project does not exist"}}}
        },
    },
    "HealthStatus": {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["ok", "degraded"]},
            "checks": {"type": "object", "additionalProperties": {"type": ["string", "object"]}},
            "timestamp": {"type": "string", "format": "date-time"},
        },
    },
    "Pagination": {
        "type": "object",
        "properties": {
            "items": {"type": "array", "items": {"type": "object"}},
            "total": {"type": "integer"},
            "page": {"type": "integer"},
            "limit": {"type": "integer"},
        },
    },
    "Project": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "format": "uuid"},
            "projectId": {"type": "string"},
            "name": {"type": "string"},
            "country": {"type": "string"},
            "methodology": {"type": "string"},
            "methodologyScore": {"type": "number"},
            "projectType": {"type": "string"},
            "vintageYear": {"type": "integer"},
            "status": {"type": "string", "enum": ["pending", "verified", "suspended", "rejected"]},
            "metadataCid": {"type": "string"},
            "createdAt": {"type": "string", "format": "date-time"},
        },
    },
    "CreditBatch": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "format": "uuid"},
            "batchId": {"type": "string"},
            "serialNumber": {"type": "string"},
            "projectId": {"type": "string"},
            "amount": {"type": "string"},
            "status": {"type": "string", "enum": ["minted", "retired"]},
            "createdAt": {"type": "string", "format": "date-time"},
        },
    },
    "RetirementRecord": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "format": "uuid"},
            "retirementId": {"type": "string"},
            "batchId": {"type": "string"},
            "amount": {"type": "string"},
            "beneficiary": {"type": "string"},
            "status": {"type": "string"},
            "certificateCid": {"type": "string"},
            "createdAt": {"type": "string", "format": "date-time"},
        },
    },
    "ApiKey": {
        "type": "object",
        "properties": {
            "id": {"type": "string", "format": "uuid"},
            "name": {"type": "string"},
            "prefix": {"type": "string"},
            "createdAt": {"type": "string", "format": "date-time"},
        },
    },
    "LoginDto": {
        "type": "object",
        "required": ["publicKey", "signature"],
        "properties": {
            "publicKey": {"type": "string", "description": "Stellar public key"},
            "signature": {"type": "string", "description": "Stellar signature of the challenge"},
        },
    },
    "RegisterProjectDto": {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "country": {"type": "string"},
            "methodology": {"type": "string"},
            "projectType": {"type": "string"},
            "vintageYear": {"type": "integer"},
        },
    },
    "MintCreditsDto": {
        "type": "object",
        "properties": {
            "projectId": {"type": "string"},
            "amount": {"type": "integer"},
            "vintageYear": {"type": "integer"},
        },
    },
    "RetireCreditsDto": {
        "type": "object",
        "properties": {
            "batchId": {"type": "string"},
            "amount": {"type": "integer"},
            "beneficiary": {"type": "string"},
            "purpose": {"type": "string"},
        },
    },
    "CreateListingDto": {
        "type": "object",
        "properties": {
            "batchId": {"type": "string"},
            "pricePerCredit": {"type": "string"},
            "amount": {"type": "integer"},
        },
    },
    "PurchaseDto": {
        "type": "object",
        "properties": {
            "listingId": {"type": "string"},
            "amount": {"type": "integer"},
        },
    },
    "UpdateProjectStatusDto": {
        "type": "object",
        "properties": {
            "status": {"type": "string", "enum": ["pending", "verified", "suspended", "rejected"]},
        },
    },
    "EnqueueJobDto": {
        "type": "object",
        "properties": {
            "queue": {"type": "string"},
            "name": {"type": "string"},
            "data": {"type": "object"},
        },
    },
}

COMMON_RESPONSES = {
    "200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Ok"}}}},
    "201": {"description": "Created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Ok"}}}},
    "204": {"description": "No content"},
    "400": {"description": "Validation error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
    "401": {"description": "Unauthorized", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
    "403": {"description": "Forbidden", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
    "404": {"description": "Not found", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
    "409": {"description": "Conflict", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
    "429": {"description": "Too many requests", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
    "500": {"description": "Internal server error", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
}

JWT = [{"bearer": []}]
ADMIN = [{"bearer": []}]   # role enforcement described at the controller layer
API_KEY = [{"X-Api-Key": []}]
PUBLIC = []


def resp(code):
    return COMMON_RESPONSES[code]


def op(method, summary, tag, security=None, params=None, req_body=None, responses=None, desc=None):
    op_obj = {
        "tags": [tag],
        "summary": summary,
        "operationId": f"{tag.lower().replace('-', '_')}_{method}_{summary.lower().split(' ')[0]}",
        "responses": responses or {c: resp(c) for c in ["200", "400", "401", "404", "500"]},
    }
    if security is not None:
        op_obj["security"] = security
    elif "Auth" in tag or tag in ("auth", "key-rotation", "admin", "audit"):
        op_obj["security"] = JWT
    if params:
        op_obj["parameters"] = params
    if req_body:
        op_obj["requestBody"] = {
            "required": True,
            "content": {
                "application/json": {
                    "schema": {"$ref": f"#/components/schemas/{req_body}"},
                    "example": EXAMPLE_SCHEMAS.get(req_body, {}),
                }
            },
        }
    if desc:
        op_obj["description"] = desc
    return op_obj


EXAMPLE_SCHEMAS = {
    "RegisterProjectDto": {
        "name": "Mangrove Restoration",
        "country": "Kenya",
        "methodology": "VM001",
        "projectType": "afforestation",
        "vintageYear": 2024,
    },
    "MintCreditsDto": {"projectId": "proj_123", "amount": 100, "vintageYear": 2024},
    "RetireCreditsDto": {"batchId": "batch_abc", "amount": 5, "beneficiary": "Acme Corp", "purpose": "offset"},
    "CreateListingDto": {"batchId": "batch_abc", "pricePerCredit": "12.50", "amount": 10},
    "PurchaseDto": {"listingId": "listing_xyz", "amount": 2},
}


def ids(names):
    return [{"name": n, "in": "path", "required": True, "schema": {"type": "string"}} for n in names]


def q(name, schema="string", required=False):
    p = {"name": name, "in": "query", "required": required, "schema": {"type": schema}}
    return p


P = {}  # paths

# -------------------- health --------------------
P["/api/v1/health"] = {"get": op("get", "Service health", "health", PUBLIC, responses={"200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/HealthStatus"}}}}})}
P["/api/v1/health/pool"] = {"get": op("get", "Database pool status", "health", PUBLIC)}
P["/health"] = {"get": op("get", "Liveness probe", "health", PUBLIC)}
P["/health/ready"] = {"get": op("get", "Readiness probe (db/redis/stellar)", "health", PUBLIC)}
P["/metrics"] = {"get": op("get", "Prometheus metrics", "health", PUBLIC)}

# -------------------- auth --------------------
P["/api/v1/auth/challenge"] = {
    "get": op("get", "Get signing challenge", "auth", PUBLIC)
}
P["/api/v1/auth/verify"] = {
    "post": op("post", "Verify challenge and obtain tokens", "auth", PUBLIC, req_body="LoginDto",
               responses={"201": {"description": "Created", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Ok"}}}}})
}
P["/api/v1/auth/refresh"] = {"post": op("post", "Refresh access token", "auth", PUBLIC)}
P["/api/v1/auth/logout"] = {"post": op("post", "Logout / revoke refresh token", "auth", PUBLIC)}

# -------------------- key rotation --------------------
P["/api/v1/key-rotation/oracle"] = {"post": op("post", "Rotate oracle key", "key-rotation", JWT)}
P["/api/v1/key-rotation/admin"] = {"post": op("post", "Rotate admin key", "key-rotation", JWT)}
P["/api/v1/key-rotation/jwt"] = {"post": op("post", "Rotate JWT signing key", "key-rotation", JWT)}
P["/api/v1/key-rotation/{id}"] = {"get": op("get", "Get key rotation by id", "key-rotation", JWT, params=ids(["id"]))}
P["/api/v1/key-rotation"] = {"get": op("get", "List key rotations", "key-rotation", JWT)}

# -------------------- projects --------------------
P["/api/v1/projects"] = {
    "get": op("get", "List projects", "projects", PUBLIC,
              params=[q("page", "integer"), q("limit", "integer"), q("status")],
              responses={"200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Pagination"}}}}}),
    "post": op("post", "Create a project (developer/admin)", "projects", req_body="RegisterProjectDto"),
}
P["/api/v1/projects/search"] = {"get": op("get", "Search projects", "projects", PUBLIC, params=[q("name")])}
P["/api/v1/projects/batch-create"] = {"post": op("post", "Batch-create projects", "projects", ADMIN)}
P["/api/v1/projects/register"] = {"post": op("post", "Register project", "projects", JWT, req_body="RegisterProjectDto")}
P["/api/v1/projects/batch-update-status"] = {"post": op("post", "Batch update project status", "projects", ADMIN)}
P["/api/v1/projects/{id}"] = {"get": op("get", "Get project by id", "projects", PUBLIC, params=ids(["id"]), responses={"200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Project"}}}}})}
P["/api/v1/projects/{id}/status"] = {"patch": op("patch", "Update project status", "projects", ADMIN, params=ids(["id"]), req_body="UpdateProjectStatusDto")}
P["/api/v1/projects/{id}/verify"] = {"post": op("post", "Verify project", "projects", JWT, params=ids(["id"]))}
P["/api/v1/projects/{id}/reject"] = {"post": op("post", "Reject project", "projects", JWT, params=ids(["id"]))}
P["/api/v1/public/projects"] = {"get": op("get", "List public approved projects", "projects", PUBLIC)}

# -------------------- credits --------------------
P["/api/v1/credits/project/{projectId}/batches"] = {"get": op("get", "List credit batches for project", "credits", PUBLIC, params=ids(["projectId"]))}
P["/api/v1/credits/batch/{id}"] = {"get": op("get", "Get credit batch", "credits", PUBLIC, params=ids(["id"]), responses={"200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/CreditBatch"}}}}})}
P["/api/v1/credits/retirement/{id}"] = {"get": op("get", "Get retirement record", "credits", PUBLIC, params=ids(["id"]))}
P["/api/v1/credits/lookup/{serial}"] = {"get": op("get", "Lookup credit by serial number", "credits", PUBLIC, params=ids(["serial"]))}
P["/api/v1/credits/provenance/{serial}"] = {"get": op("get", "Get credit provenance trail", "credits", PUBLIC, params=ids(["serial"]))}
P["/api/v1/credits/mint"] = {"post": op("post", "Mint credits", "credits", ADMIN, req_body="MintCreditsDto")}
P["/api/v1/credits/batch-mint"] = {"post": op("post", "Batch mint credits", "credits", ADMIN)}
P["/api/v1/credits/retire"] = {"post": op("post", "Retire credits", "credits", JWT, req_body="RetireCreditsDto")}
P["/api/v1/credits/batch-retire"] = {"post": op("post", "Batch retire credits", "credits", JWT)}
P["/api/v1/credits/bulk-retire"] = {"post": op("post", "Bulk retire credits (alias)", "credits", JWT)}

# -------------------- retirements --------------------
R = {"page": q("page", "integer"), "limit": q("limit", "integer")}
P["/api/v1/retirements"] = {"get": op("get", "List retirements (admin)", "retirements", JWT, params=[R["page"], R["limit"]]),
                            "post": op("post", "Create retirement", "retirements", JWT, req_body="RetireCreditsDto")}
P["/api/v1/retirements/search"] = {"get": op("get", "Search retirements", "retirements", JWT, params=[q("beneficiary")])}
P["/api/v1/retirements/bulk"] = {"post": op("post", "Bulk retirement (async)", "retirements", JWT)}
P["/api/v1/retirements/bulk/csv"] = {"post": op("post", "Upload bulk retirement CSV (async)", "retirements", JWT)}
P["/api/v1/retirements/bulk/csv/{jobId}/status"] = {"get": op("get", "Check bulk CSV job status", "retirements", JWT, params=ids(["jobId"]))}
P["/api/v1/retirements/{id}/certificate-status"] = {"get": op("get", "Certificate generation status", "retirements", PUBLIC, params=ids(["id"]))}
P["/api/v1/retirements/{id}"] = {"get": op("get", "Get retirement by id", "retirements", JWT, params=ids(["id"]), responses={"200": {"description": "OK", "content": {"application/json": {"schema": {"$ref": "#/components/schemas/RetirementRecord"}}}}})}
P["/api/v1/retirements/{id}/certificate"] = {"get": op("get", "Get retirement certificate", "retirements", PUBLIC, params=ids(["id"]))}
P["/api/v1/retirements/generate-pdf"] = {"post": op("post", "Generate retirement PDF certificate", "retirements", JWT)}
P["/api/v1/retirements/export/csv"] = {"get": op("get", "Export retirements as CSV", "retirements", JWT)}
P["/api/v1/retirements/export/pdf"] = {"get": op("get", "Export retirements as PDF", "retirements", JWT)}
P["/api/v1/retirements/verify-integrity"] = {"post": op("post", "Verify credit integrity proof", "retirements", PUBLIC)}
P["/api/v1/retirements/verify-signature"] = {"post": op("post", "Verify retirement signature", "retirements", PUBLIC)}
P["/api/v1/retirements/{id}/zk-proof"] = {
    "get": op("get", "Get zk-proof for retirement", "retirements", PUBLIC, params=ids(["id"])),
    "post": op("post", "Submit zk-proof for retirement", "retirements", JWT, params=ids(["id"])),
}

# -------------------- certificates --------------------
P["/api/v1/certificates/{retirementId}"] = {"get": op("get", "Get certificate by retirement", "certificates", PUBLIC, params=ids(["retirementId"]))}
P["/api/v1/certificates/{retirementId}/pdf"] = {"get": op("get", "Download certificate PDF", "certificates", PUBLIC, params=ids(["retirementId"]))}
P["/api/v1/certificates/{retirementId}/status"] = {"get": op("get", "Certificate status", "certificates", PUBLIC, params=ids(["retirementId"]))}
P["/api/v1/certificates/{cid}/verify"] = {"get": op("get", "Verify certificate by cid", "certificates", PUBLIC, params=ids(["cid"]))}

# -------------------- marketplace --------------------
P["/api/v1/marketplace/listings"] = {
    "get": op("get", "List marketplace listings", "marketplace", PUBLIC, params=[q("status")]),
    "post": op("post", "Create listing", "marketplace", JWT, req_body="CreateListingDto"),
}
P["/api/v1/marketplace/listings/search"] = {"get": op("get", "Search listings", "marketplace", PUBLIC, params=[q("q")])}
P["/api/v1/marketplace/listings/{id}"] = {"get": op("get", "Get listing", "marketplace", PUBLIC, params=ids(["id"])),
                                          "delete": op("delete", "Remove listing", "marketplace", JWT, params=ids(["id"]))}
P["/api/v1/marketplace/listings/batch"] = {"post": op("post", "Batch create listings", "marketplace", JWT)}
P["/api/v1/marketplace/purchase"] = {"post": op("post", "Purchase credits", "marketplace", JWT, req_body="PurchaseDto")}
P["/api/v1/marketplace/bulk-purchase"] = {"post": op("post", "Bulk purchase", "marketplace", JWT)}

# -------------------- oracle --------------------
P["/api/v1/oracle/status/{projectId}"] = {"get": op("get", "Oracle status for project", "oracle", PUBLIC, params=ids(["projectId"]))}
P["/api/v1/oracle/services/health"] = {"get": op("get", "Oracle services health", "oracle", PUBLIC)}
P["/api/v1/oracle/ingest/monitoring"] = {"post": op("post", "Ingest monitoring data (oracle)", "oracle", API_KEY)}
P["/api/v1/oracle/ingest/batch-monitoring"] = {"post": op("post", "Ingest batch monitoring (oracle)", "oracle", API_KEY)}
P["/api/v1/oracle/ingest/price"] = {"post": op("post", "Ingest price (oracle)", "oracle", API_KEY)}
P["/api/v1/oracle/ingest/batch-price"] = {"post": op("post", "Ingest batch price (oracle)", "oracle", API_KEY)}
P["/api/v1/oracle/ingest/flag"] = {"post": op("post", "Flag project (oracle)", "oracle", API_KEY)}
P["/api/v1/oracle/price-approvals/hold"] = {"post": op("post", "Hold price approval (admin)", "oracle", ADMIN)}
P["/api/v1/oracle/price-approvals"] = {"get": op("get", "List price approvals (admin)", "oracle", ADMIN)}
P["/api/v1/oracle/price-approvals/{id}/approve"] = {"post": op("post", "Approve price (admin)", "oracle", ADMIN, params=ids(["id"]))}
P["/api/v1/oracle/price-approvals/{id}/reject"] = {"post": op("post", "Reject price (admin)", "oracle", ADMIN, params=ids(["id"]))}

# -------------------- stats --------------------
P["/api/v1/stats"] = {"get": op("get", "Global stats", "stats", PUBLIC)}
P["/api/v1/stats/aggregate"] = {"get": op("get", "Aggregate stats", "stats", PUBLIC)}
P["/api/v1/stats/cache"] = {"get": op("get", "Cache stats", "stats", JWT)}
P["/api/v1/stats/leaderboard"] = {"get": op("get", "Leaderboard", "stats", PUBLIC)}

# -------------------- queue --------------------
P["/api/v1/queue/jobs"] = {"post": op("post", "Enqueue job (admin)", "queue", ADMIN, req_body="EnqueueJobDto")}
P["/api/v1/queue/jobs/{id}"] = {"get": op("get", "Get job by id", "queue", ADMIN, params=ids(["id"]))}
P["/api/v1/queue/stats"] = {"get": op("get", "Queue stats (admin)", "queue", ADMIN)}

# -------------------- uploads --------------------
P["/api/v1/uploads/project/{projectId}/documents"] = {"post": op("post", "Upload project documents", "uploads", JWT, params=ids(["projectId"]))}
P["/api/v1/uploads/certificate/{retirementId}/certificate"] = {"post": op("post", "Upload certificate", "uploads", JWT, params=ids(["retirementId"]))}
P["/api/v1/uploads/webhook/pinata"] = {"post": op("post", "Pinata webhook callback", "uploads", PUBLIC)}
P["/api/v1/uploads/files"] = {"get": op("get", "List uploaded files (admin)", "uploads", ADMIN)}
P["/api/v1/uploads/files/{cid}"] = {"get": op("get", "Get uploaded file by cid", "uploads", PUBLIC, params=ids(["cid"]))}

# -------------------- audit --------------------
P["/api/v1/audit"] = {"get": op("get", "List audit records (admin)", "audit")}
P["/api/v1/audit/verify"] = {"get": op("get", "Verify audit trail (admin)", "audit")}

# -------------------- verifiers --------------------
P["/api/v1/verifiers/apply"] = {"post": op("post", "Apply to be a verifier", "verifiers", PUBLIC)}
P["/api/v1/verifiers"] = {"get": op("get", "List verifiers (admin)", "verifiers", ADMIN, params=[q("status")])}
P["/api/v1/verifiers/{id}"] = {"get": op("get", "Get verifier", "verifiers", ADMIN, params=ids(["id"]))}
P["/api/v1/verifiers/{id}/review"] = {"patch": op("patch", "Review verifier application (admin)", "verifiers", ADMIN, params=ids(["id"]))}
P["/api/v1/verifiers/{publicKey}/pending-projects"] = {"get": op("get", "Pending projects for verifier", "verifiers", JWT, params=ids(["publicKey"]))}
P["/api/v1/verifiers/{publicKey}/history"] = {"get": op("get", "Verification history", "verifiers", JWT, params=ids(["publicKey"]))}
P["/api/v1/verifiers/{publicKey}/fees"] = {"get": op("get", "Verifier fees", "verifiers", JWT, params=ids(["publicKey"]))}
P["/api/v1/verifiers/{publicKey}/fees/export"] = {"get": op("get", "Export verifier fees (CSV)", "verifiers", JWT, params=ids(["publicKey"]))}

# -------------------- admin --------------------
P["/api/v1/admin/users/{publicKey}/role"] = {"post": op("post", "Set user role (admin)", "admin", ADMIN, params=ids(["publicKey"]))}
P["/api/v1/admin/verifiers"] = {"get": op("get", "List verifiers (admin)", "admin", ADMIN),
                                "post": op("post", "Create verifier (admin)", "admin", ADMIN),
                                "delete": op("delete", "Delete verifier (admin)", "admin", ADMIN)}
P["/api/v1/admin/verifiers/{address}"] = {"delete": op("delete", "Delete verifier by address", "admin", ADMIN, params=ids(["address"]))}
P["/api/v1/admin/treasury"] = {"get": op("get", "Get treasury (admin)", "admin", ADMIN),
                               "post": op("post", "Update treasury (admin)", "admin", ADMIN)}
P["/api/v1/admin/oracle/health"] = {"get": op("get", "Oracle health (admin)", "admin", ADMIN)}
P["/api/v1/admin/reindex"] = {"post": op("post", "Trigger reindex (admin)", "admin", ADMIN)}
P["/api/v1/admin/projects/{projectId}"] = {"delete": op("delete", "Soft-delete project (admin)", "admin", ADMIN, params=ids(["projectId"]))}
P["/api/v1/admin/projects/{projectId}/restore"] = {"post": op("post", "Restore project (admin)", "admin", ADMIN, params=ids(["projectId"]))}
P["/api/v1/admin/credits/{batchId}"] = {"delete": op("delete", "Soft-delete credit batch (admin)", "admin", ADMIN, params=ids(["batchId"]))}
P["/api/v1/admin/credits/{batchId}/restore"] = {"post": op("post", "Restore credit batch (admin)", "admin", ADMIN, params=ids(["batchId"]))}
P["/api/v1/admin/retirements/{retirementId}"] = {"delete": op("delete", "Soft-delete retirement (admin)", "admin", ADMIN, params=ids(["retirementId"]))}
P["/api/v1/admin/retirements/{retirementId}/restore"] = {"post": op("post", "Restore retirement (admin)", "admin", ADMIN, params=ids(["retirementId"]))}
P["/api/v1/admin/purge"] = {"delete": op("delete", "Purge soft-deleted records (admin)", "admin", ADMIN)}
P["/api/v1/admin/audit-logs"] = {"get": op("get", "List audit logs (admin)", "admin", ADMIN)}
P["/api/v1/admin/abuse-log"] = {"get": op("get", "List abuse log (admin)", "admin", ADMIN)}
P["/api/v1/admin/satellite/quarantine"] = {"get": op("get", "List quarantined records (admin)", "admin", ADMIN)}
P["/api/v1/admin/satellite/quarantine/depth"] = {"get": op("get", "Quarantine depth (admin)", "admin", ADMIN)}
P["/api/v1/admin/satellite/quarantine/{id}"] = {"get": op("get", "Get quarantined record (admin)", "admin", ADMIN, params=ids(["id"]))}
P["/api/v1/admin/satellite/quarantine/{id}/review"] = {"post": op("post", "Review quarantined record (admin)", "admin", ADMIN, params=ids(["id"]))}

# -------------------- public API --------------------
P["/api/v1/v1/projects"] = {"get": op("get", "Public: list projects", "public-api", API_KEY)}
P["/api/v1/v1/credits/batch/{batchId}"] = {"get": op("get", "Public: credit batch", "public-api", API_KEY, params=ids(["batchId"]))}
P["/api/v1/v1/certificates/{retirementId}"] = {"get": op("get", "Public: certificate", "public-api", API_KEY, params=ids(["retirementId"]))}
P["/api/v1/v1/api-keys"] = {"post": op("post", "Provision API key", "public-api", JWT)}
P["/api/v1/public/serial/{number}"] = {"get": op("get", "Public serial lookup", "public-api", PUBLIC, params=ids(["number"]))}
P["/api/v1/public/serials"] = {"post": op("post", "Bulk public serial lookup", "public-api", PUBLIC)}

# -------------------- webhooks --------------------
P["/api/v1/webhooks"] = {"get": op("get", "List webhooks", "webhooks", JWT),
                         "post": op("post", "Register webhook", "webhooks", JWT)}
P["/api/v1/webhooks/deliveries"] = {"get": op("get", "List deliveries (admin)", "webhooks", ADMIN)}
P["/api/v1/webhooks/{id}"] = {"get": op("get", "Get webhook", "webhooks", JWT, params=ids(["id"])),
                              "delete": op("delete", "Delete webhook", "webhooks", JWT, params=ids(["id"]))}
P["/api/v1/webhooks/{id}/logs"] = {"get": op("get", "Webhook delivery logs", "webhooks", JWT, params=ids(["id"]))}

# -------------------- portfolio --------------------
P["/api/v1/portfolio/metrics"] = {"get": op("get", "Portfolio metrics", "portfolio", JWT)}
P["/api/v1/portfolio/refresh-views"] = {"get": op("get", "Refresh portfolio views", "portfolio", JWT)}

# -------------------- logs / observability --------------------
P["/api/v1/logs"] = {"post": op("post", "Ingest client log (204)", "logs", PUBLIC, responses={"204": {"description": "No content"}})}
P["/api/v1/logs/by-correlation-id"] = {"get": op("get", "Logs by correlation id (admin)", "logs", ADMIN, params=[q("correlationId", required=True)])}
P["/api/v1/observability/metrics"] = {"get": op("get", "Observability metrics", "logs", ADMIN)}

DOC = {
    "openapi": "3.1.0",
    "info": {
        "title": "CarbonLedger API",
        "version": "1.0.0",
        "description": (
            "Verified carbon credits. Permanent retirement. Full provenance.\n\n"
            "## Authentication\n"
            "- **JWT** (Bearer) — obtain via `POST /api/v1/auth/verify`.\n"
            "- **API Key** (`X-Api-Key`) — for public API gateway endpoints.\n\n"
            "## Versioning\nAll routes are served under `/api/v1/`.\n\n"
            "## CarbonError codes\n"
            "| Code | Name |\n|------|------|\n"
            "| 1 | ProjectNotFound |\n| 2 | ProjectNotVerified |\n| 3 | ProjectSuspended |\n"
            "| 4 | InsufficientCredits |\n| 5 | AlreadyRetired |\n| 6 | SerialNumberConflict |\n"
            "| 7 | UnauthorizedVerifier |\n| 8 | UnauthorizedOracle |\n| 9 | InvalidVintageYear |\n"
            "| 10 | ListingNotFound |\n| 11 | InsufficientLiquidity |\n| 12 | PriceNotSet |\n"
            "| 13 | MonitoringDataStale |\n| 14 | DoubleCountingDetected |\n| 15 | RetirementIrreversible |\n"
            "| 16 | ZeroAmountNotAllowed |\n| 17 | ProjectAlreadyExists |\n| 18 | InvalidSerialRange |"
        ),
        "contact": {"name": "CarbonLedger", "url": "https://carbonledger.io"},
    },
    "servers": [
        {"url": "https://api.carbonledger.io", "description": "Production"},
        {"url": "http://localhost:3001", "description": "Local development"},
    ],
    "tags": [
        {"name": "health"}, {"name": "auth"}, {"name": "key-rotation"}, {"name": "projects"},
        {"name": "credits"}, {"name": "retirements"}, {"name": "certificates"}, {"name": "marketplace"},
        {"name": "oracle"}, {"name": "stats"}, {"name": "queue"}, {"name": "uploads"}, {"name": "audit"},
        {"name": "verifiers"}, {"name": "admin"}, {"name": "public-api"}, {"name": "webhooks"},
        {"name": "portfolio"}, {"name": "logs"},
    ],
    "paths": P,
    "components": {
        "securitySchemes": {
            "bearer": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"},
            "X-Api-Key": {"type": "apiKey", "in": "header", "name": "X-Api-Key"},
        },
        "schemas": SCHEMAS,
    },
}


def postman_url(path, base):
    segs = []
    for seg in path.split("/"):
        if not seg:
            continue
        if seg[0] == "{" and seg[-1] == "}":
            segs.append(":" + seg[1:-1])
        else:
            segs.append(seg)
    return base + "/" + "/".join(segs)


def build_postman(doc):
    base = doc["servers"][0]["url"]
    host = base.replace("https://", "").replace("http://", "").split(".")
    items = []
    for path in sorted(doc["paths"]):
        for method, op_obj in doc["paths"][path].items():
            if method not in ("get", "post", "put", "patch", "delete", "head", "options"):
                continue
            headers = [{"key": "Content-Type", "value": "application/json"}]
            sec = op_obj.get("security", [])
            if any("bearer" in s for s in sec):
                headers.append({"key": "Authorization", "value": "Bearer {{bearerToken}}"})
            if any("X-Api-Key" in s for s in sec):
                headers.append({"key": "X-Api-Key", "value": "{{apiKey}}"})
            body = None
            rb = op_obj.get("requestBody")
            if rb:
                body = {
                    "mode": "raw",
                    "raw": json.dumps(
                        rb.get("content", {}).get("application/json", {}).get("example", {}),
                        indent=2,
                    ) or "{}",
                    "options": {"raw": {"language": "json"}},
                }
            full = postman_url(path, base)
            items.append({
                "name": f"{method.upper()} {path}",
                "request": {
                    "method": method.upper(),
                    "header": headers,
                    "url": {
                        "raw": full,
                        "host": host,
                        "path": [s for s in path.split("/") if s],
                        "query": [],
                    },
                    "description": op_obj.get("summary", ""),
                    **({"body": body} if body else {}),
                },
                "response": [],
            })
    return {
        "info": {
            "name": "CarbonLedger API",
            "description": "Consolidated Postman collection generated from the OpenAPI spec.",
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
            "version": doc["info"]["version"],
        },
        "item": items,
        "variable": [
            {"key": "host", "value": base, "type": "string"},
            {"key": "bearerToken", "value": "", "type": "string"},
            {"key": "apiKey", "value": "", "type": "string"},
        ],
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    backend = os.path.dirname(here)
    docs_dir = os.path.join(backend, "docs")
    api_dir = os.path.join(docs_dir, "api")
    os.makedirs(api_dir, exist_ok=True)

    # YAML
    try:
        import yaml
    except Exception:
        import ruamel.yaml as yaml

    yaml_dump = yaml.safe_dump if hasattr(yaml, "safe_dump") else yaml.dump
    with open(os.path.join(api_dir, "openapi.yaml"), "w") as f:
        f.write(yaml_dump(DOC, sort_keys=False))

    # JSON (kept for backwards compatibility next to the yaml)
    with open(os.path.join(api_dir, "openapi.json"), "w") as f:
        json.dump(DOC, f, indent=2)

    # Postman collection
    collection = build_postman(DOC)
    with open(os.path.join(api_dir, "carbonledger.postman_collection.json"), "w") as f:
        json.dump(collection, f, indent=2)

    # Also write openapi.json to docs/ root (existing location)
    with open(os.path.join(docs_dir, "openapi.json"), "w") as f:
        json.dump(DOC, f, indent=2)

    print(f"Wrote {len(DOC['paths'])} paths -> docs/api/ and docs/openapi.json")


if __name__ == "__main__":
    main()
