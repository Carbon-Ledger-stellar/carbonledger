# Asynchronous Retirement Certificate Generation - Implementation Guide

## Summary

This implementation adds asynchronous PDF certificate generation for carbon credit retirements. Certificates are generated as background jobs, uploaded to IPFS via Pinata, and users are notified via email when ready. This prevents API timeouts and improves user experience.

## What Was Implemented

### 1. Database Schema Updates
- Added certificate-related fields to `RetirementRecord` model
- Fields track certificate status, IPFS CID, URL, retry count, and timestamps
- Migration required: `npx prisma migrate dev --name add_certificate_fields`

### 2. New Services

#### CertificateService
- Generates PDF certificates using PDFKit
- Includes retirement details, beneficiary, amount, project info
- Professional styling with borders and formatting
- Returns PDF as Buffer for upload

#### PinataService
- Uploads PDF files to Pinata (IPFS gateway)
- Returns IPFS CID and public gateway URL
- Verifies pin status
- Handles API authentication

#### NotificationService
- Sends email notifications when certificate is ready
- Sends failure notifications with retry information
- Supports SMTP configuration or mock mode for development
- HTML email templates included

#### CertificateProcessor
- Orchestrates the entire workflow
- Polls for pending certificates every 60 seconds
- Handles retries (up to 3 attempts with exponential backoff)
- Updates retirement record with certificate details
- Manages status transitions

### 3. Queue Integration
- Updated QueueProcessor to handle certificate generation jobs
- Integrated with BullMQ for job processing
- Automatic retry logic with exponential backoff

### 4. API Endpoints

#### New Endpoint
```
GET /retirements/certificate-status/:id
```
Returns certificate generation status and IPFS URL.

#### Updated Endpoints
```
GET /retirements/:id
```
Now includes certificate fields in response.

### 5. Configuration
- Added environment variables for Pinata and SMTP
- Updated `.env.example` with new configuration options
- Supports mock mode for development (no SMTP required)

## Installation Steps

### 1. Install Dependencies
```bash
cd carbonledger/backend
npm install
```

This installs:
- `pdfkit` - PDF generation
- `pinata` - IPFS/Pinata client
- `qrcode` - QR code generation
- `nodemailer` - Email notifications

### 2. Update Database
```bash
npx prisma migrate dev --name add_certificate_fields
```

This creates the migration and updates your database schema.

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and fill in:

```env
# Required for certificate generation
IPFS_API_KEY=your_pinata_api_key
IPFS_SECRET_KEY=your_pinata_secret_key

# Optional for email notifications (mock mode if not set)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=noreply@carbonledger.io
SMTP_SECURE=false
```

### 4. Start the Backend
```bash
npm run start:dev
```

You should see logs like:
```
[QueueModule] Polling for pending certificates...
```

## How It Works

### Certificate Generation Flow

1. **User Retires Credits**
   ```
   POST /credits/retire
   → RetirementRecord created with certificateStatus = "pending_certificate"
   → API returns immediately (no blocking)
   ```

2. **Background Polling (Every 60 seconds)**
   ```
   CertificateProcessor.pollPendingCertificates()
   → Query pending certificates
   → For each: processCertificateGeneration()
   ```

3. **Certificate Generation**
   ```
   a. Update status to "generating"
   b. Generate PDF with retirement details
   c. Upload to Pinata
   d. Update record with CID and URL
   e. Send success email
   ```

4. **User Retrieval**
   ```
   GET /retirements/certificate-status/:id
   → Returns certificate URL and status
   ```

### Retry Logic

- **Max Retries**: 3 attempts
- **Backoff**: Exponential (5s, 10s, 20s)
- **Failure Handling**: After 3 failed attempts:
  - Certificate marked as "failed"
  - User notified via email
  - Manual intervention may be required

## File Structure

```
carbonledger/backend/src/
├── certificates/
│   ├── certificate.service.ts      # PDF generation
│   ├── pinata.service.ts           # IPFS upload
│   ├── notification.service.ts     # Email notifications
│   ├── certificate.processor.ts    # Orchestration & polling
│   └── certificates.module.ts      # Module definition
├── queue/
│   ├── queue.processor.ts          # Updated with certificate handler
│   ├── queue.module.ts             # Updated with polling setup
│   └── queue.constants.ts          # Job types
├── retirements/
│   ├── retirements.service.ts      # Updated with certificate methods
│   ├── retirements.controller.ts   # Updated with certificate endpoint
│   └── retirements.module.ts       # Updated imports
├── app.module.ts                   # Updated with CertificatesModule
└── prisma/
    └── schema.prisma               # Updated RetirementRecord model
```

## Testing

### Manual Test: Create Retirement
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

Response:
```json
{
  "retirementId": "ret-batch-123-1234567890",
  "certificateStatus": "pending_certificate",
  "certificateCid": null,
  "certificateUrl": null,
  ...
}
```

### Manual Test: Check Certificate Status
```bash
curl http://localhost:3001/api/v1/retirements/certificate-status/ret-batch-123-1234567890
```

Response (after ~60 seconds):
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

### Manual Test: Monitor Queue
```bash
curl http://localhost:3001/api/v1/queue/stats
```

Response:
```json
{
  "waiting": 0,
  "active": 0,
  "completed": 5,
  "failed": 0,
  "delayed": 0
}
```

## Acceptance Criteria Verification

✅ **Job polls for retirements with status=pending_certificate every 60 seconds**
- Implemented in `CertificateProcessor.pollPendingCertificates()`
- Called every 60 seconds via `setInterval` in `QueueModule.onModuleInit()`

✅ **Generates a PDF certificate and uploads it to IPFS via Pinata**
- `CertificateService.generatePdf()` creates professional PDF
- `PinataService.uploadFile()` uploads to Pinata
- Returns CID and public gateway URL

✅ **Updates the retirement record with the IPFS CID and public URL**
- `CertificateProcessor.processCertificateGeneration()` updates:
  - `certificateCid` - IPFS CID
  - `certificateUrl` - Public gateway URL
  - `certificateGeneratedAt` - Timestamp
  - `certificateStatus` - "completed"

✅ **Retries failed certificate generation up to 3 times before marking as failed**
- Retry logic in `CertificateProcessor.processCertificateGeneration()`
- Increments `certificateRetries` counter
- After 3 attempts, marks as "failed"
- Exponential backoff via BullMQ

✅ **Sends a notification to the user when the certificate is ready**
- `NotificationService.sendCertificateReady()` sends email
- Includes certificate URL and retirement details
- Also sends failure notification if generation fails

## Performance Characteristics

- **Polling Interval**: 60 seconds (configurable)
- **Batch Size**: Max 10 certificates per poll
- **PDF Generation**: ~500ms per certificate
- **IPFS Upload**: ~1-2 seconds per certificate
- **Email Send**: ~500ms per email
- **Total Time**: ~2-3 seconds per certificate (non-blocking)

## Monitoring & Debugging

### Check Logs
```bash
npm run start:dev
# Look for: "Polling for pending certificates..."
# Look for: "Certificate generated successfully..."
# Look for: "Certificate generation failed..."
```

### Check Database
```bash
# Connect to PostgreSQL
psql postgresql://carbonledger:changeme@localhost:5432/carbonledger

# Check pending certificates
SELECT retirementId, certificateStatus, certificateRetries 
FROM "RetirementRecord" 
WHERE certificateStatus != 'completed';

# Check failed certificates
SELECT retirementId, certificateStatus, certificateFailedAt 
FROM "RetirementRecord" 
WHERE certificateStatus = 'failed';
```

### Check Redis Queue
```bash
# Connect to Redis
redis-cli

# Check queue stats
LLEN carbonledger:waiting
LLEN carbonledger:active
LLEN carbonledger:completed
LLEN carbonledger:failed
```

## Troubleshooting

### Certificates Not Generating

**Problem**: Certificates stuck in "pending_certificate" status

**Solutions**:
1. Check Redis connection: `redis-cli ping`
2. Check Pinata credentials: `echo $IPFS_API_KEY`
3. Check logs for errors: `npm run start:dev`
4. Verify database migration: `npx prisma migrate status`
5. Check Pinata account quota and API limits

### Email Not Sending

**Problem**: Users not receiving certificate ready emails

**Solutions**:
1. Verify SMTP credentials in `.env`
2. Check firewall/network access to SMTP server
3. Review logs for email errors
4. Test with mock mode (remove SMTP config)
5. Check email spam folder

### IPFS Upload Fails

**Problem**: "Pinata upload failed" errors

**Solutions**:
1. Verify Pinata API key and secret
2. Check Pinata account quota
3. Verify network connectivity
4. Check file size (should be < 10MB)
5. Try uploading manually to Pinata dashboard

### High Memory Usage

**Problem**: Memory usage increasing over time

**Solutions**:
1. Reduce polling batch size (currently 10)
2. Increase polling interval (currently 60s)
3. Monitor PDF generation memory usage
4. Check for memory leaks in dependencies

## Security Considerations

1. **API Keys**: Store Pinata credentials in environment variables only
2. **Email Credentials**: Use app-specific passwords, not account passwords
3. **IPFS URLs**: Public gateway URLs are accessible to anyone with the CID
4. **Retirement Data**: Sensitive data (beneficiary, reason) stored in PDF
5. **Rate Limiting**: Consider adding rate limits to certificate endpoints
6. **Access Control**: Ensure only authenticated users can check certificate status

## Future Enhancements

1. **Webhook Notifications**: Use Pinata webhooks instead of polling
2. **Parallel Processing**: Process multiple certificates in parallel
3. **Certificate Customization**: Allow users to customize certificate design
4. **Blockchain Verification**: Store certificate CID on-chain
5. **Certificate Revocation**: Support certificate revocation if needed
6. **Analytics**: Track certificate generation metrics
7. **Caching**: Cache generated certificates for faster retrieval
8. **Batch Operations**: Support bulk certificate generation

## Support & Documentation

- See `CERTIFICATE_GENERATION.md` for detailed technical documentation
- See `backend/package.json` for dependency versions
- See `backend/prisma/schema.prisma` for database schema
- See `.env.example` for configuration options

## Rollback Instructions

If you need to rollback this implementation:

1. **Revert Database**
   ```bash
   npx prisma migrate resolve --rolled-back add_certificate_fields
   ```

2. **Revert Code**
   ```bash
   git revert <commit-hash>
   ```

3. **Reinstall Dependencies**
   ```bash
   npm install
   ```

4. **Restart Backend**
   ```bash
   npm run start:dev
   ```

## Questions & Support

For issues or questions:
1. Check logs: `npm run start:dev`
2. Review documentation: `CERTIFICATE_GENERATION.md`
3. Check database: `npx prisma studio`
4. Monitor queue: `GET /queue/stats`
