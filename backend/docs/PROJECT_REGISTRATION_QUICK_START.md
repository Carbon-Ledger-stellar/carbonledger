# Project Registration with Documents - Quick Start Guide

## TL;DR

New endpoint: `POST /projects/register-with-documents`

Allows project developers to register carbon projects with verification documents (PDF/PNG, ≤10MB).

## Usage Examples

### 1. cURL

```bash
curl -X POST https://your-api.com/projects/register-with-documents \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "projectId=solar-farm-2024" \
  -F "name=Solar Farm Kenya" \
  -F "description=3MW solar installation" \
  -F "methodology=ACM0002" \
  -F "country=Kenya" \
  -F "projectType=solar_energy" \
  -F "verifierAddress=GVERIFIER123" \
  -F "ownerAddress=GPROJECT001" \
  -F "vintageYear=2024" \
  -F "methodologyScore=85" \
  -F "verification_documents=@verra-cert.pdf"
```

### 2. JavaScript (Fetch API)

```javascript
const token = 'your-jwt-token';
const projectData = {
  projectId: 'solar-farm-2024',
  name: 'Solar Farm Kenya',
  description: '3MW solar installation',
  methodology: 'ACM0002',
  country: 'Kenya',
  projectType: 'solar_energy',
  verifierAddress: 'GVERIFIER123',
  ownerAddress: 'GPROJECT001',
  vintageYear: 2024,
  methodologyScore: 85,
};

const fileInput = document.getElementById('file-input');
const formData = new FormData();

// Add form fields
Object.entries(projectData).forEach(([key, value]) => {
  formData.append(key, value);
});

// Add file
formData.append('verification_documents', fileInput.files[0]);

// Send request
const response = await fetch(
  '/projects/register-with-documents',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
    },
    body: formData,
  }
);

const result = await response.json();

if (response.ok) {
  console.log('✓ Project registered:', result.data.projectId);
  console.log('  Gateway URL:', result.data.document.ipfsGatewayUrl);
  console.log('  CID:', result.data.document.cid);
} else {
  console.error('✗ Registration failed:', result.message);
}
```

### 3. React Component Example

```jsx
import { useState } from 'react';

function ProjectRegistration({ jwtToken }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [projectId, setProjectId] = useState('');
  const [fileName, setFileName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(e.target);
    
    try {
      const response = await fetch('/projects/register-with-documents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwtToken}`,
        },
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Registration failed');
      }

      setProjectId(data.data.projectId);
      setFileName(data.data.document.fileName);
      e.target.reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2>Register Project with Document</h2>
      {error && <div className="error">{error}</div>}
      
      {projectId ? (
        <div className="success">
          ✓ Project registered: {projectId}
          <br />
          Document: {fileName}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <input type="text" name="projectId" placeholder="Project ID" required />
          <input type="text" name="name" placeholder="Project Name" required />
          <input type="text" name="methodology" placeholder="Methodology" required />
          <input type="text" name="country" placeholder="Country" required />
          <input type="text" name="projectType" placeholder="Project Type" required />
          <input type="text" name="verifierAddress" placeholder="Verifier Address" required />
          <input type="text" name="ownerAddress" placeholder="Owner Address" required />
          <input type="number" name="vintageYear" placeholder="Vintage Year" required />
          <input type="number" name="methodologyScore" placeholder="Methodology Score (0-100)" required />
          <input type="file" name="verification_documents" accept=".pdf,.png" required />
          
          <button type="submit" disabled={loading}>
            {loading ? 'Uploading...' : 'Register Project'}
          </button>
        </form>
      )}
    </div>
  );
}

export default ProjectRegistration;
```

## Request Format

### Form Fields

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `projectId` | string | Yes | 1-64 chars, unique |
| `name` | string | Yes | 1-128 chars |
| `description` | string | No | 0-1024 chars |
| `methodology` | string | Yes | 1-64 chars (e.g., ACM0002) |
| `country` | string | Yes | 1-64 chars |
| `projectType` | string | Yes | 1-64 chars |
| `verifierAddress` | string | Yes | Valid Stellar address (G...) |
| `ownerAddress` | string | Yes | Valid Stellar address (G...) |
| `vintageYear` | number | Yes | 1990 to current year + 1 |
| `methodologyScore` | number | Yes | 0-100, minimum 70 required |

### File Upload

| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| `verification_documents` | file | Yes | PDF or PNG, ≤10 MB |

## Response Format

### Success (201)

```json
{
  "success": true,
  "message": "Project registered successfully with verification document",
  "data": {
    "projectId": "solar-farm-2024",
    "id": "clxxxx",
    "name": "Solar Farm Kenya",
    "status": "Pending",
    "document": {
      "id": "uuid",
      "cid": "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco",
      "fileName": "verra-cert.pdf",
      "fileType": "application/pdf",
      "fileSize": 1048576,
      "pinStatus": "pending",
      "uploadedAt": "2026-08-30T10:00:00Z",
      "ipfsGatewayUrl": "https://gateway.pinata.cloud/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"
    }
  }
}
```

### Error Examples

#### 400 - Invalid File Type
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "code": "BAD_REQUEST",
  "message": "Invalid file type. Only PDF and PNG files are allowed."
}
```

#### 413 - File Too Large
```json
{
  "statusCode": 413,
  "error": "Payload Too Large",
  "code": "PAYLOAD_TOO_LARGE",
  "message": "File size exceeds 10MB limit (12.50MB)"
}
```

#### 409 - Duplicate Project
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "code": "CONFLICT",
  "message": "Project solar-farm-2024 already exists"
}
```

## Validation Rules

### File Validation
- ✓ Accepted: `application/pdf`, `image/png`
- ✗ Rejected: All other file types
- ✓ Size: ≤ 10 MB (10,485,760 bytes)
- ✗ Size: > 10 MB

### Project Data Validation
- ✓ Methodology Score: 70-100 (minimum 70 required)
- ✗ Score: < 70
- ✓ Project ID: Must be unique (no duplicates)
- ✓ Vintage Year: 1990 to (current year + 1)
- ✓ Stellar Addresses: Valid public keys (start with G)

## Common Errors & Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Verification document is required" | File not attached | Check field name: `verification_documents` |
| "Invalid file type" | Wrong file format | Use PDF or PNG only |
| "File size exceeds 10MB" | File too large | Compress or reduce file size |
| "Project already exists" | Duplicate ID | Use unique projectId |
| "methodology score below 70" | Score too low | Ensure score ≥ 70 |
| "Authorization header missing" | No JWT token | Include `Authorization: Bearer {token}` |
| "Insufficient permissions" | Wrong role | Must be project_developer or admin |

## What Happens Next

1. **Immediate Response** (< 1 second)
   - Project created in database
   - Document CID received from IPFS
   - Gateway URL available immediately
   - Project status: `Pending`

2. **Background (async)**
   - Document pinning to IPFS continues
   - Pin status updates: `pending` → `pinned` or `failed`
   - Updates tracked via webhook

3. **Verification**
   - Verifiers can see project and document
   - Document accessible via provided IPFS gateway URL
   - Project can be approved or rejected

4. **Project Lifecycle**
   - `Pending` → `Verified` (verifier approves)
   - `Pending` → `Rejected` (verifier rejects)
   - `Verified` → `Completed` (admin completes)

## Document Access

Once registered, document can be accessed:

```
https://gateway.pinata.cloud/ipfs/{cid}
```

Example:
```
https://gateway.pinata.cloud/ipfs/QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco
```

## Testing Endpoint

### Using Postman

1. Create new POST request: `{{baseUrl}}/projects/register-with-documents`
2. Headers:
   - `Authorization: Bearer {{jwt_token}}`
   - Content-Type: `multipart/form-data` (auto-set)
3. Body (form-data):
   - Add text fields: projectId, name, methodology, country, projectType, verifierAddress, ownerAddress, vintageYear, methodologyScore
   - Add file field: `verification_documents` → select PDF or PNG file
4. Send request

### Using Thunder Client

Similar to Postman, but in VS Code:
1. Install Thunder Client extension
2. Create new request
3. Set method to POST, URL to endpoint
4. Add Authorization header with Bearer token
5. Set Body to multipart form
6. Add fields and file, send

## Integration with Frontend

### Key Points for UI Implementation

1. **File Input**
   ```html
   <input type="file" accept=".pdf,.png" required />
   ```

2. **Form Validation**
   - Check file size before upload (< 10 MB)
   - Show file name to user
   - Validate methodology score (≥ 70)

3. **Loading State**
   - Show spinner during upload
   - Disable submit button during upload
   - Provide upload progress feedback

4. **Success Feedback**
   - Show confirmation message
   - Display IPFS gateway URL
   - Provide link to view document
   - Show project ID for reference

5. **Error Handling**
   - Display error message to user
   - Show which field has problem
   - Provide helpful suggestions
   - Log error details for debugging

## Security Notes

- File type validated by MIME type (can be spoofed)
- Client-side file type validation recommended
- All data sanitized to prevent injection
- Stellar addresses validated
- JWT token required and validated
- Role-based access control enforced

## Performance Notes

- IPFS pinning happens asynchronously
- Initial response includes CID (available immediately)
- Full pin status available after ~30 seconds
- Large file uploads may take longer
- Consider timeout: 60+ seconds for 10 MB files

## Reference

- **Full API Docs**: See `PROJECT_REGISTRATION_DOCUMENTS.md`
- **Test Suite**: See `backend/test/projects-register-documents.e2e-spec.ts`
- **Implementation**: See `backend/src/projects/`
- **IPFS Service**: See `backend/src/uploads/ipfs-upload.service.ts`

## Support

For issues or questions:
1. Check error message for specific problem
2. Review troubleshooting section in full docs
3. Check test suite for examples
4. Review logs for detailed error information
