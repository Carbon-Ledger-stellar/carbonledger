# Asynchronous Retirement Certificate PDF Generation

## Overview

This implementation provides asynchronous generation and storage of retirement certificate PDFs on IPFS via Pinata, preventing API timeouts and improving user experience. Certificates are generated as BullMQ background jobs with professional PDF layouts including QR codes linking to on-chain audit records.

## Architecture

### Components

1. **CertificateService** (`src/certificates/certificate.service.ts`)
   - Generates PDF certificates using PDFKit
   - Renders certificate with retirement details, QR code, and professional styling
   - Includes: project name, vintage year, tonnes retired, beneficiary, retirement date, serial number range, Stellar transaction hash
   - QR code encodes `https://carbonledger.io/audit/retirement/{retirementId}` for on-chain verification
   - Returns PDF as Buffer for upload

2. **PinataService** (`src/certificates/pinata.service.ts`)
   - Uploads PDF files to Pinata (IPFS)
   - Returns IPFS CID and public gateway URL
   - Verifies pin status via Pinata SDK
   - Provides `getPublicUrl(cid)` helper

3. **NotificationService** (`src/certificates/notification.service.ts`)
   - Sends email notifications when certificate is ready
   - Sends failure notifications with retry information
   - Supports SMTP configuration or mock mode for development

4. **CertificateProcessor** (`src/certificates/certificate.processor.ts`)
   - Orchestrates the entire certificate generation workflow
   - Handles retries (up to 3 attempts with exponential backoff)
   - Polls for pending certificates every 60 seconds
   - Updates retirement record with certificate status and IPFS details
   - Invoked via BullMQ job from QueueProcessor

5. **CertificatesController** (`src/certificates/certificates.controller.ts`)
   - `GET /certificates/{retirementId}` — Public certificate metadata (JSON)
   - `GET /certificates/{retirementId}/pdf` — Returns PDF from IPFS or generates on demand
   - `GET /certificates/{retirementId}/status` — Returns certificate generation status

6. **QueueProcessor** (`src/queue/queue.processor.ts`)
   - Processes BullMQ jobs including `certificate_generation`
   - Delegates to CertificateProcessor for certificate generation jobs

## Database Schema

### RetirementRecord Fields

```prisma
model RetirementRecord {
  // ... existing fields ...
  
  // Certificate fields
  certificateCid           String?
  certificateUrl           String?
  certificateStatus        String    @default("pending_certificate")
  certificateRetries       Int       @default(0)
  certificateFailedAt      DateTime?
  certificateGeneratedAt   DateTime?
}
```

### Certificate Status States

- `pending_certificate` — Waiting to be processed by polling
- `generating` — Currently generating PDF and uploading to IPFS
- `completed` — Successfully generated and stored on IPFS
- `failed` — Failed after 3 retry attempts

## Workflow

### 1. Retirement Creation

When a user retires credits:

```
1. RetirementRecord created with certificateStatus = "pending_certificate"
2. BullMQ job enqueued via QueueService for async certificate generation
3. API returns immediately (non-blocking)
```

### 2. Certificate Generation (Polling)

Every 60 seconds, QueueModule polls for pending certificates:

```
1. Query RetirementRecord where certificateStatus = "pending_certificate"
2. For each pending retirement:
   a. Update status to "generating"
   b. Generate PDF certificate with QR code
   c. Upload PDF to Pinata (IPFS)
   d. Update record with CID and URL
   e. Mark status as "completed"
   f. Send success email notification
3. On failure:
   a. Increment retry counter
   b. If retries < 3: reset to "pending_certificate"
   c. If retries >= 3: mark as "failed" and send failure email
```

### 3. Certificate Retrieval

**PDF Download (from IPFS or on-demand):**
```
GET /certificates/{retirementId}/pdf
→ Tries IPFS gateway first (if CID exists)
→ Falls back to on-demand generation
→ Returns PDF with proper caching headers
```

**Generation Status:**
```
GET /certificates/{retirementId}/status
→ Returns "pending" | "ready" | "error"
→ Includes CID, URL, retry count, and timestamps
```

**Certificate Metadata (JSON):**
```
GET /certificates/{retirementId}
→ Returns full retirement and project metadata
→ Includes verification URL for on-chain audit
```

## API Endpoints

### Get Certificate Metadata (Public)
```
GET /certificates/{retirementId}
```

Response:
```json
{
  "retirementId": "uuid",
  "amount": "100",
  "retiredBy": "GXXXXXX",
  "beneficiary": "Company XYZ",
  "retirementReason": "Carbon offset",
  "vintageYear": 2024,
  "serialNumbers": ["KE-001-2024-001", "..."],
  "serialStart": "KE-001-2024-001",
  "serialEnd": "KE-001-2024-100",
  "txHash": "abc123...",
  "retiredAt": "2024-05-30T10:30:00Z",
  "projectId": "PROJ001",
  "batchId": "BATCH001",
  "certificateCid": "QmXxxx...",
  "certificateStatus": "completed",
  "certificateUrl": "https://gateway.pinata.cloud/ipfs/QmXxxx...",
  "verificationUrl": "https://stellar.expert/explorer/testnet/tx/abc123...",
  "ipfsUrl": "https://gateway.pinata.cloud/ipfs/QmXxxx...",
  "project": {
    "name": "Solar Farm Project",
    "country": "KE",
    "methodology": "ACM0002"
  }
}
```

### Get Certificate PDF
```
GET /certificates/{retirementId}/pdf
```

Returns: `application/pdf` with `Content-Disposition: inline`

Response headers:
- `X-Certificate-Source: ipfs` (cached) or `generated` (on-demand)
- `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600`

### Get Certificate Status
```
GET /certificates/{retirementId}/status
```

Response:
```json
{
  "retirementId": "uuid",
  "status": "pending",
  "cid": null,
  "url": null,
  "retries": 0,
  "generatedAt": null,
  "failedAt": null
}
```

## Configuration

### Environment Variables

```env
# Pinata / IPFS (v2 SDK — use PINATA_JWT exclusively)
PINATA_JWT=your_pinata_jwt
# Legacy fallback (not recommended): IPFS_API_KEY + IPFS_SECRET_KEY
# IPFS_API_KEY=your_pinata_api_key
# IPFS_SECRET_KEY=your_pinata_secret_key

# Email (optional — mock mode if not configured)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=noreply@carbonledger.io
SMTP_SECURE=false

# Redis (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

> **Note on Pinata v2 SDK**: The `pinata` npm package v2.x uses a JWT-based authentication model. Set `PINATA_JWT` in your environment (you can generate one from the Pinata dashboard). The legacy `IPFS_API_KEY` + `IPFS_SECRET_KEY` pair is no longer supported directly by the SDK; the service falls back to concatenating them as `${apiKey}:${secretKey}`, but migrating to `PINATA_JWT` is strongly recommended.

## Dependencies

- `pdfkit` — PDF generation
- `qrcode` — QR code generation (PNG buffers)
- `pinata` — IPFS/Pinata SDK (v2.x — uses `PINATA_JWT` for auth)
- `nodemailer` — Email notifications
- `bullmq` + `@nestjs/bullmq` — Job queue
- `@prisma/client` — Database ORM

## Error Handling

### Retry Logic

- **Max Retries**: 3 attempts
- **Backoff**: Exponential (5s, 10s, 20s)
- **Failure Handling**: After 3 failed attempts, certificate marked as "failed" and user notified

### Failure Scenarios

1. **PDF Generation Fails** — Logged and retried; user notified after 3 attempts
2. **Pinata Upload Fails** — Network error or quota exceeded; retried automatically
3. **Email Notification Fails** — Does not block certificate generation; logged as warning

## Performance

- **PDF Generation**: ~500ms per certificate
- **IPFS Upload**: ~1-2 seconds per certificate
- **Polling Cycle**: Every 60 seconds, max 10 certificates per cycle
- **On-demand PDF**: Generates in real-time (cached via IPFS when available)

## Testing

### E2E Tests (`backend/test/certificate.e2e-spec.ts`)

```bash
npm run test:e2e -- certificate.e2e-spec.ts
```

Covers:
- Certificate metadata retrieval
- PDF generation and download
- Certificate status endpoint
- Full generate → status → PDF retrieval lifecycle
- Data integrity validation

### Manual Testing

```bash
# 1. Check certificate metadata
curl http://localhost:3001/api/v1/certificates/RET001

# 2. Check certificate status
curl http://localhost:3001/api/v1/certificates/RET001/status

# 3. Download PDF
curl -o certificate.pdf http://localhost:3001/api/v1/certificates/RET001/pdf

# 4. Monitor queue stats
curl http://localhost:3001/api/v1/queue/stats
```

## Migration Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Generate Prisma Client**
   ```bash
   npx prisma generate
   ```

3. **Run Prisma Migration**
   ```bash
   npx prisma migrate dev --name add_certificate_status_fields
   ```

4. **Configure Environment**
   - Set `PINATA_JWT` in `.env` (or `IPFS_API_KEY` + `IPFS_SECRET_KEY` as legacy fallback)
   - (Optional) Configure SMTP for email notifications

5. **Start Backend**
   ```bash
   npm run start:dev
   ```

6. **Verify Polling**
   - Check logs for "Polling for pending certificates..."
   - Should appear every 60 seconds

## File Structure

```
backend/src/certificates/
├── certificate.service.ts       # PDF generation with PDFKit + QR code
├── pinata.service.ts            # IPFS/Pinata upload
├── notification.service.ts      # Email notifications
├── certificate.processor.ts     # Orchestration, polling, retries
├── certificates.controller.ts   # REST endpoints (metadata, PDF, status)
├── certificates.module.ts       # NestJS module definition
└── README.md                    # Module documentation
```

## Security Considerations

1. **API Keys**: Pinata credentials stored in environment variables only
2. **Email Credentials**: Use app-specific passwords, not account passwords
3. **IPFS URLs**: Public gateway URLs accessible to anyone with the CID
4. **Retirement Data**: Sensitive data (beneficiary, reason) stored in PDF
5. **QR Code**: Links to public audit page on carbonledger.io

## References

- [PDFKit Documentation](http://pdfkit.org/)
- [Pinata API Documentation](https://docs.pinata.cloud/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [NestJS BullMQ Integration](https://docs.nestjs.com/techniques/queues)
- [QRCode npm](https://www.npmjs.com/package/qrcode)
