# CarbonLedger Pause API Postman Collection

This directory contains the Postman Collection and Environment files for executing and testing all pause-related API endpoints.

## Files
- `CarbonLedger_Pause_API.postman_collection.json`: Collection containing all 4 endpoints with pre-configured headers, bodies, pre-request scripts, and test assertions.
- `CarbonLedger_Testnet.postman_environment.json`: Pre-configured environment variables for the testnet deployment.

## Endpoints Included
1. **GET `/api/v1/contract/status`**: Verify contract operational status and pause expiry timestamp.
2. **POST `/api/v1/admin/pause`**: Trigger emergency contract pause (with duration and reason).
3. **POST `/api/v1/admin/unpause`**: Resume normal contract operations.
4. **GET `/api/v1/admin/pause-history`**: Query audit history of past pause and unpause operations.

## Running via Postman UI
1. Open Postman.
2. Click **Import** in the upper left.
3. Select both `CarbonLedger_Pause_API.postman_collection.json` and `CarbonLedger_Testnet.postman_environment.json`.
4. Set your active environment to `CarbonLedger Testnet Environment`.
5. Update the `adminAuthToken` variable with your valid JWT.

## Running via Newman CLI (Automated CI/CD)
```bash
newman run docs/postman/CarbonLedger_Pause_API.postman_collection.json \
  -e docs/postman/CarbonLedger_Testnet.postman_environment.json \
  --env-var "adminAuthToken=$TESTNET_ADMIN_TOKEN"
```
