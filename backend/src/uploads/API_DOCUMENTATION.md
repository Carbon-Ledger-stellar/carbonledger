# IPFS Upload API Documentation

## Overview
Centralized service for uploading project documents and certificates to IPFS via Pinata.

## Base URL
```
POST /uploads/project/:projectId/documents
POST /uploads/certificate/:retirementId/certificate
POST /uploads/webhook/pinata
GET  /uploads/files
GET  /uploads/files/:cid
```

## Endpoints

### 1. Upload Project Document
Upload PDF or JSON documents for a carbon project.

**Endpoint:** `POST /uploads/project/:projectId/documents`  
**Content-Type:** `multipart/form-data`

**Request:**
- `file` (required): File to upload (PDF or JSON)
- `projectId` (path): ID of the project

**Validation:**
- File type: `application/pdf` or `application/json` only
- File size: Maximum 50MB

**Response (200):**
```json
{
  "success": true,
  "message": "File uploaded successfully. Pinning in progress.",
  "data": {
    "id": "uuid",
    "cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    "fileName": "project-doc.pdf",
    "fileType": "application/pdf",
    "fileSize": 1024000,
    "pinStatus": "pending",
    "linkedEntityType": "project",
    "linkedEntityId": "proj-001",
    "uploadedAt": "2026-04-25T13:00:00.000Z",
    "ipfsGatewayUrl": "https://gateway.pinata.cloud/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
  }
}
```

**Errors:**
- `400 Bad Request`: No file uploaded, invalid file type, or file too large
- `500 Internal Server Error`: Pinata upload failed

---

### 2. Upload Retirement Certificate
Upload PDF certificates for carbon credit retirements.

**Endpoint:** `POST /uploads/certificate/:retirementId/certificate`  
**Content-Type:** `multipart/form-data`

**Request:**
- `file` (required): PDF certificate to upload
- `retirementId` (path): ID of the retirement record

**Validation:**
- File type: `application/pdf` only
- File size: Maximum 50MB

**Response (200):**
```json
{
  "success": true,
  "message": "Certificate uploaded successfully. Pinning in progress.",
  "data": {
    "id": "uuid",
    "cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    "fileName": "certificate.pdf",
    "fileType": "application/pdf",
    "fileSize": 512000,
    "pinStatus": "pending",
    "linkedEntityType": "certificate",
    "linkedEntityId": "ret-001",
    "uploadedAt": "2026-04-25T13:00:00.000Z",
    "ipfsGatewayUrl": "https://gateway.pinata.cloud/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
  }
}
```

**Errors:**
- `400 Bad Request`: No file uploaded, invalid file type, or file too large
- `500 Internal Server Error`: Pinata upload failed

---

### 3. Pinata Webhook
Receive pin status updates from Pinata.

**Endpoint:** `POST /uploads/webhook/pinata`  
**Content-Type:** `application/json`

**Request Body:**
```json
{
  "id": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
  "status": "pinned",
  "pinataApiError": null
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Webhook processed"
}
```

**Errors:**
- `400 Bad Request`: Missing or invalid webhook data
- `500 Internal Server Error`: Webhook processing failed

---

### 4. List Uploaded Files
Retrieve uploaded files with optional filters.

**Endpoint:** `GET /uploads/files`

**Query Parameters:**
- `pinStatus` (optional): Filter by pin status (pending, pinned, failed)
- `linkedEntityType` (optional): Filter by entity type (project, certificate, batch)
- `linkedEntityId` (optional): Filter by entity ID

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      "fileName": "project-doc.pdf",
      "fileType": "application/pdf",
      "fileSize": 1024000,
      "pinStatus": "pinned",
      "linkedEntityType": "project",
      "linkedEntityId": "proj-001",
      "uploadedAt": "2026-04-25T13:00:00.000Z",
      "pinnedAt": "2026-04-25T13:05:00.000Z"
    }
  ]
}
```

---

### 5. Get File by CID
Retrieve a specific file by its CID.

**Endpoint:** `GET /uploads/files/:cid`

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
    "fileName": "project-doc.pdf",
    "fileType": "application/pdf",
    "fileSize": 1024000,
    "pinStatus": "pinned",
    "linkedEntityType": "project",
    "linkedEntityId": "proj-001",
    "uploadedAt": "2026-04-25T13:00:00.000Z",
    "pinnedAt": "2026-04-25T13:05:00.000Z"
  }
}
```

**Errors:**
- `404 Not Found`: File not found

---

## Database Schema

### IPFSFile Table
```sql
id              VARCHAR   PRIMARY KEY
cid             VARCHAR   INDEXED
fileName        VARCHAR
fileType        VARCHAR   -- "application/pdf" or "application/json"
fileSize        INT       -- in bytes
pinStatus       VARCHAR   -- "pending" | "pinned" | "failed"
linkedEntityType VARCHAR  -- "project" | "certificate" | "batch"
linkedEntityId  VARCHAR
uploadedAt      TIMESTAMP
pinnedAt        TIMESTAMP
projectId       VARCHAR   FOREIGN KEY (optional)
batchId         VARCHAR   FOREIGN KEY (optional)
retirementId    VARCHAR   FOREIGN KEY (optional)
```

## Pinata Integration

### Upload Flow
1. File is validated (type & size)
2. Record is created in DB with `pinStatus: "pending"`
3. File is uploaded to Pinata via their API
4. CID is returned and stored in DB
5. Async pinning is triggered (fire-and-forget)
6. Pin status is updated to `"pinned"` or `"failed"`

### Async Pinning
- Pinning happens asynchronously after initial upload
- Status updates to `"pinned"` when Pinata confirms
- Status updates to `"failed"` if pinning fails
- Webhook support for real-time status updates from Pinata

## Environment Variables
```
IPFS_API_URL=https://api.pinata.cloud
IPFS_API_KEY=your_pinata_api_key
IPFS_SECRET_KEY=your_pinata_secret_key
```

## File Size Limit
- Maximum file size: **50MB** (52,428,800 bytes)
- Enforced at both API and service layers

## Accepted File Types
- **PDF Documents**: `application/pdf`
- **JSON Documents**: `application/json`
- **Certificates**: `application/pdf` only

## CID Storage
- CID is stored immutably with the file record
- Files are pinned permanently on Pinata
- CID can be used to retrieve file from IPFS gateway: `https://gateway.pinata.cloud/ipfs/{cid}`

## Related Database Models
- `CarbonProject.ipfsFiles[]` - Project documents
- `CreditBatch.ipfsFiles[]` - Batch documents
- `RetirementRecord.ipfsFiles[]` - Retirement certificates