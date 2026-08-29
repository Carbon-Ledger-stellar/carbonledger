# Certificate Generation - Quick Start

## 30-Second Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Run database migration**
   ```bash
   npx prisma migrate dev --name add_certificate_fields
   ```

3. **Configure environment** (`.env`)
   ```env
   IPFS_API_KEY=your_pinata_key
   IPFS_SECRET_KEY=your_pinata_secret
   ```

4. **Start backend**
   ```bash
   npm run start:dev
   ```

Done! Certificates will generate automatically every 60 seconds.

## Test It

### 1. Create a retirement
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

Copy the `retirementId` from response.

### 2. Check certificate status (wait ~60 seconds)
```bash
curl http://localhost:3001/api/v1/retirements/certificate-status/ret-batch-123-1234567890
```

You'll see:
```json
{
  "status": "completed",
  "url": "https://gateway.pinata.cloud/ipfs/QmXxxx...",
  "cid": "QmXxxx..."
}
```

### 3. Download the certificate
Open the URL in your browser or:
```bash
curl https://gateway.pinata.cloud/ipfs/QmXxxx... -o certificate.pdf
```

## What Happens Behind the Scenes

1. **Retirement created** → `certificateStatus = "pending_certificate"`
2. **Every 60 seconds** → System polls for pending certificates
3. **For each pending** → Generates PDF, uploads to IPFS, sends email
4. **User notified** → Email with certificate link
5. **Status updated** → `certificateStatus = "completed"`, `certificateUrl` set

## Configuration

### Required
- `IPFS_API_KEY` - Pinata API key
- `IPFS_SECRET_KEY` - Pinata secret key

### Optional (Email)
- `SMTP_HOST` - SMTP server (e.g., smtp.gmail.com)
- `SMTP_PORT` - SMTP port (usually 587)
- `SMTP_USER` - Email address
- `SMTP_PASS` - Email password or app password
- `SMTP_FROM` - From address (default: noreply@carbonledger.io)

If SMTP not configured, emails are logged to console (mock mode).

## Troubleshooting

### Certificates not generating?
1. Check logs: `npm run start:dev` (look for "Polling for pending certificates...")
2. Verify Pinata credentials: `echo $IPFS_API_KEY`
3. Check Redis: `redis-cli ping` (should return PONG)
4. Check database: `npx prisma studio`

### Email not sending?
1. Verify SMTP credentials
2. Check logs for email errors
3. Try mock mode (remove SMTP config)

### IPFS upload failing?
1. Verify Pinata API key and secret
2. Check Pinata account quota
3. Verify network connectivity

## Files Changed

- `prisma/schema.prisma` - Added certificate fields
- `src/app.module.ts` - Added CertificatesModule
- `src/queue/queue.module.ts` - Added polling setup
- `src/queue/queue.processor.ts` - Added certificate handler
- `src/retirements/` - Added certificate endpoints
- `src/certificates/` - New module with all services
- `.env.example` - Added new environment variables
- `package.json` - Added dependencies

## Next Steps

1. Read `CERTIFICATE_GENERATION.md` for detailed docs
2. Read `../IMPLEMENTATION_GUIDE.md` for full guide
3. Check logs: `npm run start:dev`
4. Test with real retirement
5. Configure email (optional)
6. Deploy to production

## Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/credits/retire` | Create retirement (returns immediately) |
| GET | `/retirements/:id` | Get retirement details |
| GET | `/retirements/certificate-status/:id` | Get certificate status & URL |
| GET | `/queue/stats` | Monitor queue |

## Performance

- **Polling**: Every 60 seconds
- **PDF Generation**: ~500ms
- **IPFS Upload**: ~1-2 seconds
- **Email**: ~500ms
- **Total**: ~2-3 seconds per certificate (non-blocking)

## Support

- Full documentation: `CERTIFICATE_GENERATION.md`
- Implementation guide: `../IMPLEMENTATION_GUIDE.md`
- Database schema: `prisma/schema.prisma`
- Environment config: `.env.example`
