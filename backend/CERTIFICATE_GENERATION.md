# Asynchronous Retirement Certificate Generation

## Overview

This implementation provides asynchronous generation and storage of retirement certificates on IPFS, preventing API timeouts and improving user experience. Certificates are generated as background jobs and stored on Pinata (IPFS gateway).

## Architecture

### Components

1. **CertificateService** (`src/certificates/certificate.service.ts`)
   - Generates PDF certificates using PDFKit
   - Renders certificate with retirement details, QR code, and styling
   - Returns PDF as Buffer for upload

2. **PinataService** (`src/certificates/pinata.service.ts`)
   - Uploads PDF files to Pinata (IPFS)
   - Returns IPFS CID and public gateway URL
   - Verifies pin status

3. **NotificationService** (`src/certificates/notification.service.ts`)
   - Sends email notifications when certificate is ready
   - Sends failure notifications with retry information
   - Supports SMTP configuration or mock mode for development

4. **CertificateProcessor** (`src/certificates/certificate.processor.ts`)
   - Orchestrates the entire certificate generation workflow
   - Handles retries (up to 3 attempts)
   - Polls for pending certificates every 60 seconds
   - Updates retirement record with certificate status and IPFS details

5. **QueueProcessor** (`src/queue/queue.processor.ts`)
   - Processes BullMQ jobs
   - Routes certificate generation jobs to CertificateProcessor

## Database Schema

### RetirementRecord Updates

```prisma
model RetirementRecord {
  // ... existing fields ...
  
  // Certificate fields
  certificateStatus     String   @default("pending_certificate")
  certificateCid        String?  // IPFS CID from Pinata
  certificateUrl        String?  // Public IPFS gateway URL
  certificateRetries    Int      @default(0)
  certificateFailedAt   DateTime?
  certificateGeneratedAt DateTime?
}
```

### Certificate Status States

- `pending_certificate` - Waiting to be processed
- `generating` - Currently generating PDF and uploading to IPFS
- `completed` - Successfully generated and stored
- `failed` - Failed after 3 retry attempts

## Workflow

### 1. Retirement Creation

When a user retires credits via `POST /credits/retire`:

```
1. RetirementRecord created with certificateStatus = "pending_certificate"
2. Batch and project totals updated
3. API returns immediately (no blocking)
```

### 2. Certificate Generation (Polling)

Every 60 seconds, the system polls for pending certificates:

```
1. Query RetirementRecord where certificateStatus = "pending_certificate"
2. For each pending retirement:
   a. Update status to "generating"
   b. Generate PDF certificate
   c. Upload to Pinata
   d. Update record with CID and URL
   e. Send success email
3. On failure:
   a. Increment retry counter
   b. If retries < 3: reset to "pending_certificate"
   c. If retries >= 3: mark as "failed" and send failure email
```

### 3. Certificate Retrieval

Users can check certificate status via:

```
GET /retirements/certificate-status/:id
```

Response:
```json
{
  "retirementId": "ret-batch-123-1234567890",
  "status": "completed",
  "cid": "QmXxxx...",
  "url": "https://gateway.pinata.cloud/ipfs/QmXxxx...",
  "generatedAt": "2024-05-30T10:30:00Z",
  "failedAt": null,
  "retries": 0
}
```

## API Endpoints

### Get Certificate Status
```
GET /retirements/certificate-status/:id
```

Returns certificate generation status and IPFS URL.

### Get Full Retirement Record
```
GET /retirements/:id
```

Returns complete retirement record including certificate fields.

## Configuration

### Environment Variables

```env
# Pinata / IPFS
IPFS_API_KEY=your_pinata_api_key
IPFS_SECRET_KEY=your_pinata_secret_key

# Email (optional - mock mode if not configured)
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

## Dependencies Added

```json
{
  "pdfkit": "^0.13.0",        // PDF generation
  "pinata": "^2.1.0",         // IPFS/Pinata client
  "qrcode": "^1.5.3",         // QR code generation
  "nodemailer": "^6.9.7"      // Email notifications
}
```

## Error Handling

### Retry Logic

- **Max Retries**: 3 attempts
- **Backoff**: Exponential (5s, 10s, 20s)
- **Failure Handling**: After 3 failed attempts, certificate marked as failed and user notified

### Failure Scenarios

1. **PDF Generation Fails**
   - Logged and retried
   - User notified after 3 attempts

2. **Pinata Upload Fails**
   - Network error or quota exceeded
   - Retried automatically
   - User notified if persistent

3. **Email Notification Fails**
   - Does not block certificate generation
   - Logged as warning
   - Can be retried manually

## Monitoring

### Queue Statistics

```
GET /queue/stats
```

Returns:
```json
{
  "waiting": 5,
  "active": 2,
  "completed": 150,
  "failed": 3,
  "delayed": 0
}
```

### Job Status

```
GET /queue/jobs/:jobId
```

Returns job details including state, attempts, and failure reason.

## Performance Considerations

1. **Polling Interval**: 60 seconds (configurable in `queue.module.ts`)
2. **Batch Processing**: Max 10 certificates per poll cycle
3. **Async Processing**: Non-blocking, doesn't impact retirement API response time
4. **IPFS Gateway**: Uses Pinata's public gateway for immediate access

## Testing

### Manual Testing

1. Create a retirement:
```bash
curl -X POST http://localhost:3001/api/v1/credits/retire \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "batch-123",
    "amount": 100,
    "beneficiary": "Company XYZ",
    "retirementReason": "Carbon offset",
    "holderPublicKey": "GXXXXXX"
  }'
```

2. Check certificate status:
```bash
curl http://localhost:3001/api/v1/retirements/certificate-status/ret-batch-123-1234567890
```

3. Monitor queue:
```bash
curl http://localhost:3001/api/v1/queue/stats
```

## Migration Steps

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Run Prisma Migration**
   ```bash
   npx prisma migrate dev --name add_certificate_fields
   ```

3. **Configure Environment**
   - Set `IPFS_API_KEY` and `IPFS_SECRET_KEY` in `.env`
   - (Optional) Configure SMTP for email notifications

4. **Start Backend**
   ```bash
   npm run start:dev
   ```

5. **Verify Polling**
   - Check logs for "Polling for pending certificates..."
   - Should appear every 60 seconds

## Future Enhancements

1. **Webhook Notifications**: Instead of polling, use Pinata webhooks
2. **Batch Processing**: Process multiple certificates in parallel
3. **Certificate Customization**: Allow users to customize certificate design
4. **Blockchain Verification**: Store certificate CID on-chain for immutability
5. **Certificate Revocation**: Support certificate revocation if needed
6. **Analytics**: Track certificate generation metrics and performance

## Troubleshooting

### Certificates Not Generating

1. Check Redis connection: `redis-cli ping`
2. Check Pinata credentials in `.env`
3. Review logs for errors: `npm run start:dev`
4. Verify database migration ran: `npx prisma migrate status`

### Email Not Sending

1. Verify SMTP credentials
2. Check firewall/network access to SMTP server
3. Review email logs in application output
4. Test with mock mode (no SMTP configured)

### IPFS Upload Fails

1. Verify Pinata API key and secret
2. Check Pinata account quota
3. Verify network connectivity
4. Check file size (PDFs should be < 10MB)

## Security Considerations

1. **API Keys**: Store Pinata credentials in environment variables only
2. **Email Credentials**: Use app-specific passwords, not account passwords
3. **IPFS URLs**: Public gateway URLs are accessible to anyone with the CID
4. **Retirement Data**: Sensitive data (beneficiary, reason) stored in PDF
5. **Rate Limiting**: Consider adding rate limits to certificate endpoints

## References

- [PDFKit Documentation](http://pdfkit.org/)
- [Pinata API Documentation](https://docs.pinata.cloud/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Nodemailer Documentation](https://nodemailer.com/)
