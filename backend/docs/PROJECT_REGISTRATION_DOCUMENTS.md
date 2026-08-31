# Project Registration with Verification Documents

## Overview

The project registration endpoint (`POST /projects/register-with-documents`) allows project developers to register carbon projects with verification documents via multipart form upload. This fulfills the acceptance criteria for issue #1014.

## Feature Summary

- **Multipart form-based upload** for seamless integration with web clients
- **File type validation** (PDF and PNG only)
- **File size validation** (maximum 10 MB)
- **IPFS/Pinata integration** for decentralized document storage
- **Database linking** of uploaded documents to projects
- **Role-based access control** (project_developer and admin only)
- **Comprehensive error handling** with meaningful messages

## Endpoint

### Register Project with Documents

```http
POST /projects/register-with-documents
Content-Type: multipart/form-data
Authorization: Bearer {jwt_token}
```

## Request Parameters

### Form Fields (all required except `description`)

| Field | Type | Max Length | Description |
|-------|------|-----------|-------------|
| `projectId` | string | 64 | Unique project identifier |
| `name` | string | 128 | Project name |
| `description` | string | 1024 | Project description (optional) |
| `methodology` | string | 64 | Methodology code (e.g., ACM0002) |
| `country` | string | 64 | Country where project is located |
| `projectType` | string | 64 | Type of project (e.g., solar_energy, wind_energy) |
| `verifierAddress` | string | - | Stellar public key of assigned verifier (G...) |
| `ownerAddress` | string | - | Stellar public key of project owner (G...) |
| `vintageYear` | number | - | Vintage year (1990 to current year + 1) |
| `methodologyScore` | number | - | Methodology quality score (0-100, minimum 70) |

### File Upload

| Field | Type | Allowed MIME Types | Max Size | Description |
|-------|------|-------------------|----------|-------------|
| `verification_documents` | file | `application/pdf`, `image/png` | 10 MB | Verification document (Verra certificate, methodology, etc.) |

## Response Format

### Success Response (201 Created)

```json
{
  "success": true,
  "message": "Project registered successfully with verification document",
  "data": {
    "projectId": "test-project-001",
    "id": "cuid-format-id",
    "name": "Solar Farm Project",
    "status": "Pending",
    "document": {
      "id": "file-uuid",
      "cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      "fileName": "verra-certificate.pdf",
      "fileType": "application/pdf",
      "fileSize": 1024000,
      "pinStatus": "pending",
      "uploadedAt": "2026-08-30T10:00:00.000Z",
      "ipfsGatewayUrl": "https://gateway.pinata.cloud/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
    }
  }
}
```

### Error Responses

#### 400 Bad Request - Missing File

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "BAD_REQUEST",
  "message": "Verification document is required"
}
```

#### 400 Bad Request - Invalid File Type

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "BAD_REQUEST",
  "message": "Invalid file type. Only PDF and PNG files are allowed."
}
```

#### 413 Payload Too Large - File Size Exceeded

```json
{
  "statusCode": 413,
  "error": "Payload Too Large",
  "code": "PAYLOAD_TOO_LARGE",
  "message": "File size exceeds 10MB limit (12.50MB)"
}
```

#### 409 Conflict - Duplicate Project

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "CONFLICT",
  "message": "Project test-project-001 already exists"
}
```

#### 409 Conflict - Low Methodology Score

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "CONFLICT",
  "message": "Project registration rejected: methodology score 65 is below minimum 70/100"
}
```

#### 401 Unauthorized - Missing Token

```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "code": "UNAUTHORIZED",
  "message": "Authorization header missing or malformed"
}
```

#### 403 Forbidden - Insufficient Role

```json
{
  "statusCode": 403,
  "error": "Forbidden",
  "code": "FORBIDDEN",
  "message": "Insufficient permissions"
}
```

#### 500 Internal Server Error

```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "code": "INTERNAL_ERROR",
  "message": "Failed to register project with documents. Please try again."
}
```

## Validation Rules

### File Validation
- **Accepted MIME Types**: `application/pdf`, `image/png`
- **File Size Limit**: 10 MB (10,485,760 bytes)
- **File Required**: Yes

### Project Data Validation
- **Duplicate ProjectId**: Not allowed (409 error)
- **Methodology Score**: Minimum 70 required (0-100 valid range)
- **Vintage Year**: Must be between 1990 and current year + 1
- **Stellar Addresses**: Must be valid public keys (G...)
- **String Fields**: Subject to sanitization to prevent injection

### Authentication & Authorization
- **Authentication Required**: Yes (Bearer JWT)
- **Allowed Roles**: `project_developer`, `admin`
- **Resource Scoping**: Project developer role is scoped by resource policies

## File Storage

### IPFS/Pinata Integration
- Documents are uploaded to Pinata (IPFS pinning service)
- Content addressing provides immutable reference via IPFS CID
- CID is immediately returned while pinning continues asynchronously
- Pin status tracks: `pending` → `pinned` or `failed`
- Documents remain pinned indefinitely for project verification

### Database Storage
- Project is created with `status: 'Pending'`
- Document CID stored in `CarbonProject.metadataCid` field
- IPFSFile record created with document metadata
- Document linked to project via `linkedEntityType: 'project'` and `linkedEntityId: projectId`

## Example Usage

### cURL

```bash
curl -X POST https://api.carbonledger.example/projects/register-with-documents \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "projectId=solar-kenya-001" \
  -F "name=Solar Farm Kenya" \
  -F "description=3MW solar farm in Kenya" \
  -F "methodology=ACM0002" \
  -F "country=Kenya" \
  -F "projectType=solar_energy" \
  -F "verifierAddress=GVERIF456" \
  -F "ownerAddress=GDEV001" \
  -F "vintageYear=2024" \
  -F "methodologyScore=85" \
  -F "verification_documents=@./verra-certificate.pdf"
```

### JavaScript/Fetch

```javascript
const formData = new FormData();
formData.append('projectId', 'solar-kenya-001');
formData.append('name', 'Solar Farm Kenya');
formData.append('description', '3MW solar farm in Kenya');
formData.append('methodology', 'ACM0002');
formData.append('country', 'Kenya');
formData.append('projectType', 'solar_energy');
formData.append('verifierAddress', 'GVERIF456');
formData.append('ownerAddress', 'GDEV001');
formData.append('vintageYear', '2024');
formData.append('methodologyScore', '85');
formData.append('verification_documents', fileInput.files[0]);

const response = await fetch(
  'https://api.carbonledger.example/projects/register-with-documents',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
    },
    body: formData,
  }
);

const result = await response.json();
console.log('Project registered:', result.data);
console.log('Document CID:', result.data.document.cid);
console.log('Gateway URL:', result.data.document.ipfsGatewayUrl);
```

### Python/Requests

```python
import requests

url = 'https://api.carbonledger.example/projects/register-with-documents'

headers = {
    'Authorization': f'Bearer {jwt_token}'
}

files = {
    'verification_documents': open('verra-certificate.pdf', 'rb')
}

data = {
    'projectId': 'solar-kenya-001',
    'name': 'Solar Farm Kenya',
    'description': '3MW solar farm in Kenya',
    'methodology': 'ACM0002',
    'country': 'Kenya',
    'projectType': 'solar_energy',
    'verifierAddress': 'GVERIF456',
    'ownerAddress': 'GDEV001',
    'vintageYear': '2024',
    'methodologyScore': '85'
}

response = requests.post(url, headers=headers, data=data, files=files)
result = response.json()

print('Project registered:', result['data'])
print('Document CID:', result['data']['document']['cid'])
```

## Document Access

Once registered, documents can be accessed via:

1. **IPFS Gateway URL** (provided in response)
   ```
   https://gateway.pinata.cloud/ipfs/{cid}
   ```

2. **CID-based lookup** (via future endpoint)
   ```
   GET /uploads/files/{cid}
   ```

## Workflow

```
1. Project Developer submits form with project data + PDF/PNG document
   ↓
2. Server validates file type (PDF/PNG only) and size (≤10MB)
   ↓
3. Server sanitizes form data to prevent injection attacks
   ↓
4. Server checks for duplicate projectId
   ↓
5. Server validates methodology score (≥70)
   ↓
6. Server uploads document to Pinata IPFS
   ↓
7. Server receives CID from Pinata (immutable content hash)
   ↓
8. Server creates CarbonProject record with CID as metadataCid
   ↓
9. Server creates IPFSFile record linking document to project
   ↓
10. Server returns project + document metadata with gateway URL
    ↓
11. Client can access document immediately via gateway URL
    ↓
12. Async pinning continues in background (updated via webhook)
```

## Database Schema

### CarbonProject Fields Used
- `projectId`: Unique identifier
- `name`: Project name
- `description`: Project description
- `methodology`: Methodology code
- `country`: Country location
- `projectType`: Type of project
- `ownerAddress`: Owner's Stellar public key
- `verifierAddress`: Verifier's Stellar public key
- `vintageYear`: Vintage year
- `methodologyScore`: Methodology score
- `metadataCid`: IPFS CID of verification document
- `status`: Project status (set to 'Pending')
- `createdAt`: Timestamp of creation

### IPFSFile Record Linked
- `cid`: IPFS content hash
- `fileName`: Original filename
- `fileType`: MIME type (application/pdf or image/png)
- `fileSize`: Size in bytes
- `pinStatus`: Pin status (pending/pinned/failed)
- `linkedEntityType`: 'project'
- `linkedEntityId`: projectId
- `uploadedAt`: Upload timestamp
- `pinnedAt`: When pinning completed (async)

## Error Handling & Logging

### Validation Errors
- All validation errors return 400/409/413 status codes with descriptive messages
- Client receives actionable feedback for form correction
- Injection attempts are sanitized and rejected

### Logging
- All errors logged with context: projectId, file info, error message
- Stack traces logged for 5xx errors (not exposed to client)
- Upload failures tracked with CID and pin status

### Recovery
- If IPFS upload fails, project is not created (transaction-like behavior)
- Automatic retry not implemented; client should retry request
- Failed uploads logged for debugging

## Security Considerations

1. **File Type Validation**
   - MIME type checked (application/pdf, image/png only)
   - Prevents code injection via arbitrary file types
   - Note: MIME type can be spoofed; client-side validation recommended

2. **File Size Limits**
   - 10 MB limit prevents storage exhaustion
   - Enforced at controller and service layers

3. **Data Sanitization**
   - All form fields sanitized to prevent SQL/NoSQL injection
   - Filenames sanitized before storage
   - Stellar addresses validated as valid public keys

4. **Role-Based Access Control**
   - Only project_developer and admin can register
   - JWT token required and validated
   - Token blacklist checked for revoked tokens

5. **Resource Scoping**
   - Project developers scoped to own resources (via CASL policies)
   - Admin has unrestricted access

## Related Endpoints

- `POST /projects/register` - Register project without documents
- `POST /projects` - Create project without on-chain registration
- `GET /projects/{projectId}` - Retrieve project details
- `GET /uploads/files` - List all uploaded files (admin only)
- `GET /uploads/files/{cid}` - Get file by CID

## Implementation Notes

- **File Interceptor**: Uses NestJS `FileInterceptor('verification_documents')`
- **Async Operations**: IPFS pinning happens asynchronously; initial response includes CID
- **Webhook Support**: Pinata webhooks update pin status in background
- **Error Format**: Follows CarbonLedger standard error envelope (statusCode, error, code, message)
- **Response Format**: Follows CarbonLedger standard with success flag and data wrapper

## Testing

Comprehensive test suite in `backend/test/projects-register-documents.e2e-spec.ts` covers:

- Valid PDF and PNG uploads
- Invalid file types (text, DOCX, JPEG)
- File size validation (at limit, over limit, under limit)
- Missing file validation
- Duplicate projectId handling
- Methodology score validation
- Authentication/authorization
- Database integrity
- IPFS gateway URL format

Run tests with:
```bash
npm run test:e2e -- projects-register-documents
```

## Troubleshooting

### 400 Error - "Verification document is required"
- Check that form field is named `verification_documents`
- Ensure file is being attached to the request

### 400 Error - "Invalid file type"
- Verify file is actually PDF (application/pdf) or PNG (image/png)
- Check MIME type is correct (MIME type spoofing can occur)
- Try uploading a different file type to confirm

### 413 Error - "File size exceeds 10MB"
- Verify file is actually under 10 MB (10,485,760 bytes)
- Check file explorer shows correct size
- Try compressing PDF or resizing PNG

### 409 Error - "already exists"
- Choose a unique projectId
- Check project wasn't already registered earlier

### 500 Error - Internal Server Error
- Check logs for IPFS upload failure
- Verify IPFS_API_KEY and IPFS_SECRET_KEY are configured
- Retry request (transient network error)

## Future Enhancements

- Support for multiple documents per project
- Batch project registration with documents
- Document versioning and updates
- Advanced metadata extraction from PDFs
- Document preview/thumbnail generation
- Full-text search across documents
- Document retention policies
