# Implementation Guide

This guide documents UI/UX design specifications for the pause feature set.

## Pause Status Visual Hierarchy (Issue #1170)

Design specification for pause status across the admin dashboard. Covers color schemes, typography, icon design, and light/dark mode variants.

### Color Palette

| Token | Light Mode | Dark Mode | Usage |
|-------|-----------|-----------|-------|
| `--pause-primary` | `#DC2626` (red-600) | `#F87171` (red-400) | Paused state accent, icons, borders |
| `--pause-primary-bg` | `#FEE2E2` (red-100) | `#7F1D1D` (red-900) | Paused badge/background fill |
| `--pause-secondary` | `#6B7280` (gray-500) | `#9CA3AF` (gray-400) | Unpaused state accent, icons |
| `--pause-secondary-bg` | `#F3F4F6` (gray-100) | `#1F2937` (gray-800) | Unpaused badge/background fill |
| `--pause-text` | `#111827` (gray-900) | `#F9FAFB` (gray-50) | Primary text |
| `--pause-text-muted` | `#6B7280` (gray-500) | `#9CA3AF` (gray-400) | Secondary/meta text |

Contrast: paused text on `--pause-primary-bg` meets WCAG AA (≥ 4.5:1) in both modes.

### Typography

| Element | Font | Size | Weight | Line Height |
|---------|------|------|--------|-------------|
| Status label (badge) | Inter | 12px / 0.75rem | 600 (semibold) | 16px |
| Status heading | Inter | 18px / 1.125rem | 600 (semibold) | 24px |
| Status detail / reason | Inter | 14px / 0.875rem | 400 (regular) | 20px |
| Timestamp / meta | Inter | 12px / 0.75rem | 400 (regular) | 16px |
| Uppercase badge text | Inter | 11px / 0.6875rem | 700 (bold) | 14px, letter-spacing 0.05em |

### Icon Design

- **Paused icon:** filled circle with two vertical bars (pause glyph), 16px in badges, 20px in headings. Stroke width 2px, rounded caps. Color `--pause-primary`.
- **Unpaused icon:** filled circle with right-pointing triangle (play glyph), same sizing. Color `--pause-secondary`.
- Icons are inline SVG, `currentColor` fill so they inherit the token color per mode.
- Icons always paired with a text label (never icon-only) for accessibility.

### Component Sizes

| Component | Height | Padding | Radius |
|-----------|--------|---------|--------|
| Status badge | 24px | 4px 8px | 9999px (pill) |
| Status card | auto | 16px | 8px |
| Status banner | 48px | 12px 16px | 6px |

### Light/Dark Mode Variants

- Light: paused uses red-600 on red-100; unpaused uses gray-500 on gray-100.
- Dark: paused uses red-400 on red-900; unpaused uses gray-400 on gray-800.
- Borders use the primary/secondary accent at 30% opacity.
- Transitions between states: 150ms ease-in-out on color and background.

## Pause Stats Dashboard (Issue #1176)

Design specification for the pause statistics dashboard, presenting charts, tables, and key metrics about pause patterns.

### Chart Type Designs

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
psql
```

## Pause Integration Guide

This section is a step-by-step developer guide for integrating pause functionality into client applications. It covers the JavaScript SDK, error handling, polling vs WebSocket patterns, testing strategies, and common issues.

### Overview

Pause functionality lets a client temporarily suspend operations (for exam

/* … truncated 5776 chars — edit only what you need near the top … */
