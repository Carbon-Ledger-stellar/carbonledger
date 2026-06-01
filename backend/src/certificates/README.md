# Certificates Module

Asynchronous PDF certificate generation and IPFS storage for carbon credit retirements.

## Overview

This module handles the complete lifecycle of retirement certificate generation:

1. **Generation**: Creates professional PDF certificates with retirement details
2. **Upload**: Stores certificates on IPFS via Pinata
3. **Notification**: Sends email notifications to users
4. **Polling**: Automatically processes pending certificates every 60 seconds
5. **Retry**: Handles failures with exponential backoff (up to 3 attempts)

## Services

### CertificateService
Generates PDF certificates using PDFKit.

```typescript
const pdf = await certificateService.generatePdf({
  retirementId: 'ret-123',
  beneficiary: 'Company XYZ',
  amount: 100,
  projectName: 'Solar Farm Project',
  retirementReason: 'Carbon offset',
  retiredAt: new Date(),
  serialNumbers: ['SN001', 'SN002'],
  vintageYear: 2023,
});
```

### PinataService
Uploads files to IPFS via Pinata.

```typescript
const { cid, url } = await pinataService.uploadFile(
  pdfBuffer,
  'certificate-ret-123.pdf',
  { retirementId: 'ret-123' }
);
```

### NotificationService
Sends email notifications.

```typescript
await notificationService.sendCertificateReady(
  'user@example.com',
  'ret-123',
  'https://gateway.pinata.cloud/ipfs/QmXxxx...',
  100
);
```

### CertificateProcessor
Orchestrates the entire workflow.

```typescript
// Process a single retirement
await certificateProcessor.processCertificateGeneration('ret-123');

// Poll for pending certificates (called every 60 seconds)
await certificateProcessor.pollPendingCertificates();
```

## Database Schema

```prisma
model RetirementRecord {
  // ... existing fields ...
  
  certificateStatus     String   @default("pending_certificate")
  certificateCid        String?
  certificateUrl        String?
  certificateRetries    Int      @default(0)
  certificateFailedAt   DateTime?
  certificateGeneratedAt DateTime?
}
```

## Certificate Status States

- `pending_certificate` - Waiting to be processed
- `generating` - Currently generating PDF and uploading to IPFS
- `completed` - Successfully generated and stored
- `failed` - Failed after 3 retry attempts

## Configuration

### Environment Variables

```env
# Pinata / IPFS
IPFS_API_KEY=your_pinata_api_key
IPFS_SECRET_KEY=your_pinata_secret_key

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
SMTP_FROM=noreply@carbonledger.io
SMTP_SECURE=false
```

## Workflow

### 1. Retirement Creation
```
User calls POST /credits/retire
→ RetirementRecord created with certificateStatus = "pending_certificate"
→ API returns immediately (non-blocking)
```

### 2. Polling (Every 60 seconds)
```
CertificateProcessor.pollPendingCertificates()
→ Query pending certificates
→ For each: processCertificateGeneration()
```

### 3. Certificate Generation
```
a. Update status to "generating"
b. Generate PDF with retirement details
c. Upload to Pinata
d. Update record with CID and URL
e. Send success email
```

### 4. Retry on Failure
```
If error:
  a. Increment retry counter
  b. If retries < 3: reset to "pending_certificate"
  c. If retries >= 3: mark as "failed" and send failure email
```

## API Endpoints

### Get Certificate Status
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

### Get Full Retirement Record
```
GET /retirements/:id
```

Returns complete retirement record including certificate fields.

## Error Handling

### Retry Logic
- **Max Retries**: 3 attempts
- **Backoff**: Exponential (5s, 10s, 20s)
- **Failure Handling**: After 3 failed attempts, certificate marked as failed

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

## Performance

- **PDF Generation**: ~500ms per certificate
- **IPFS Upload**: ~1-2 seconds per certificate
- **Email Send**: ~500ms per email
- **Total Time**: ~2-3 seconds per certificate (non-blocking)
- **Polling Cycle**: ~30 seconds for 10 certificates

## Monitoring

### Queue Statistics
```
GET /queue/stats
```

### Job Status
```
GET /queue/jobs/:jobId
```

### Logs
```
npm run start:dev
# Look for: "Polling for pending certificates..."
# Look for: "Certificate generated successfully..."
# Look for: "Certificate generation failed..."
```

## Testing

### Manual Test
```bash
# 1. Create retirement
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

# 2. Wait 60 seconds

# 3. Check certificate status
curl http://localhost:3001/api/v1/retirements/certificate-status/ret-batch-123-1234567890
```

## Troubleshooting

### Certificates Not Generating
1. Check Redis connection: `redis-cli ping`
2. Check Pinata credentials: `echo $IPFS_API_KEY`
3. Review logs: `npm run start:dev`
4. Verify database migration: `npx prisma migrate status`

### Email Not Sending
1. Verify SMTP credentials
2. Check firewall/network access
3. Review logs for email errors
4. Test with mock mode (no SMTP configured)

### IPFS Upload Fails
1. Verify Pinata API key and secret
2. Check Pinata account quota
3. Verify network connectivity
4. Check file size (should be < 10MB)

## Security

- API keys stored in environment variables only
- Email credentials use app-specific passwords
- IPFS URLs are public but require CID knowledge
- Retirement data stored in PDF
- Rate limiting recommended for production

## Dependencies

- `pdfkit` - PDF generation
- `pinata` - IPFS/Pinata client
- `qrcode` - QR code generation
- `nodemailer` - Email notifications
- `@nestjs/common` - NestJS framework
- `@prisma/client` - Database ORM

## File Structure

```
src/certificates/
├── certificate.service.ts      # PDF generation
├── pinata.service.ts           # IPFS upload
├── notification.service.ts     # Email notifications
├── certificate.processor.ts    # Orchestration & polling
├── certificates.module.ts      # Module definition
└── README.md                   # This file
```

## Integration

### In Your Module
```typescript
import { CertificatesModule } from './certificates/certificates.module';

@Module({
  imports: [CertificatesModule],
})
export class YourModule {}
```

### Using Services
```typescript
import { CertificateProcessor } from './certificates/certificate.processor';

constructor(private certificateProcessor: CertificateProcessor) {}

async generateCertificate(retirementId: string) {
  await this.certificateProcessor.processCertificateGeneration(retirementId);
}
```

## Future Enhancements

1. **Webhook Notifications**: Use Pinata webhooks instead of polling
2. **Batch Processing**: Process multiple certificates in parallel
3. **Certificate Customization**: Allow users to customize certificate design
4. **Blockchain Verification**: Store certificate CID on-chain
5. **Certificate Revocation**: Support certificate revocation if needed
6. **Analytics**: Track certificate generation metrics
7. **Caching**: Cache generated certificates for faster retrieval

## References

- [PDFKit Documentation](http://pdfkit.org/)
- [Pinata API Documentation](https://docs.pinata.cloud/)
- [Nodemailer Documentation](https://nodemailer.com/)
- [NestJS Documentation](https://docs.nestjs.com/)

## Support

For issues or questions:
1. Check logs: `npm run start:dev`
2. Review documentation: `CERTIFICATE_GENERATION.md`
3. Check database: `npx prisma studio`
4. Monitor queue: `GET /queue/stats`
