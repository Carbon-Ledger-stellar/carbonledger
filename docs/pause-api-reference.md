# Pause API Reference & Endpoint Specification

Comprehensive documentation for all endpoints managing and querying the CarbonLedger smart contract operational states.

---

## Base URLs
- **Production**: `https://api.carbonledger.io`
- **Testnet**: `https://api-testnet.carbonledger.io`

## Rate Limits
- Public endpoints (`/contract/status`): **120 requests / minute per IP**
- Admin endpoints (`/admin/pause*`): **30 requests / minute per authenticated admin account**

---

## 1. Get Contract Status
Retrieve the real-time operational state of the platform smart contracts.

- **Method**: `GET`
- **Path**: `/api/v1/contract/status`
- **Authentication**: None (Public)

### Request Example (cURL)
```bash
curl -X GET "https://api-testnet.carbonledger.io/api/v1/contract/status" \
  -H "Accept: application/json"
```

### Response Example (`200 OK`)
```json
{
  "contractId": "CCREDIT7J2XNQ5B6E4Y8WZ3M1K9L0P5R7T2V4X6Z8A0B",
  "network": "testnet",
  "isPaused": false,
  "status": "operational",
  "pauseUntil": 0,
  "pausedAt": null,
  "pausedBy": null,
  "reason": null,
  "lastVerifiedLedger": 1045239
}
```

---

## 2. Emergency Pause Contract
Halt all state-mutating operations on specified contracts.

- **Method**: `POST`
- **Path**: `/api/v1/admin/pause`
- **Authentication**: Bearer Token (`AdminRole`)

### Request Example (cURL)
```bash
curl -X POST "https://api-testnet.carbonledger.io/api/v1/admin/pause" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "durationHours": 24,
    "reason": "Investigating unexpected discrepancy in registry credit mint count",
    "affectedContracts": ["carbon_credit", "marketplace"]
  }'
```

### Response Example (`200 OK`)
```json
{
  "success": true,
  "status": "paused",
  "transactionHash": "4a7f29bb5c689d02347101ad79803bf56f10c662865c345330a1bf64c23f1124",
  "pausedUntil": 1727295330,
  "affectedContracts": ["carbon_credit", "marketplace"]
}
```

---

## 3. Resume Contract Operations (Unpause)
Restore normal transaction capabilities on paused contracts.

- **Method**: `POST`
- **Path**: `/api/v1/admin/unpause`
- **Authentication**: Bearer Token (`AdminRole`)

### Request Example (cURL)
```bash
curl -X POST "https://api-testnet.carbonledger.io/api/v1/admin/unpause" \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Investigation concluded; registry count verified against Horizon archives."
  }'
```

### Response Example (`200 OK`)
```json
{
  "success": true,
  "status": "operational",
  "transactionHash": "9b12a83ef7c02b1928374a01c349586fe09a7b6c5d4e3f2109847123958abcdef",
  "pausedUntil": 0
}
```

---

## 4. Query Pause History
Audit log of all past pause, unpause, and expiration events.

- **Method**: `GET`
- **Path**: `/api/v1/admin/pause-history`
- **Authentication**: Bearer Token (`AdminRole`)
- **Query Parameters**:
  - `limit`: integer (default: 20, max: 100)
  - `offset`: integer (default: 0)

### Response Example (`200 OK`)
```json
{
  "total": 3,
  "items": [
    {
      "id": "hist_01J8F9X2B4",
      "action": "PAUSE",
      "adminAddress": "GBXYZ76EXAMPLEADMINWALLETSTARSOLAR747362",
      "durationHours": 24,
      "reason": "Investigating unexpected discrepancy in registry credit mint count",
      "transactionHash": "4a7f29bb5c689d02347101ad79803bf56f10c662865c345330a1bf64c23f1124",
      "timestamp": "2026-09-24T20:30:00Z"
    }
  ]
}
```
