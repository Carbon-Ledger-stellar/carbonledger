import { Injectable, Logger } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import * as QRCode from 'qrcode';
import { Readable } from 'stream';

interface CertificateData {
  retirementId: string;
  beneficiary: string;
  amount: number;
  projectName: string;
  retirementReason: string;
  retiredAt: Date;
  serialNumbers: string[];
  serialStart: string;
  serialEnd: string;
  vintageYear: number;
  txHash: string;
  /** Ed25519 issuer signature over this certificate's content hash (#594). */
  issuerSignature?: string;
  issuerPublicKey?: string;
  contentHash?: string;
}

@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  async generatePdf(data: CertificateData): Promise<Buffer> {
    // Generate QR code asynchronously BEFORE entering the Promise constructor.
    // This avoids the anti-pattern of an async executor inside new Promise.
    let qrBuffer: Buffer | null = null;
    try {
      qrBuffer = await this.generateQrCode(data.retirementId);
    } catch (qrError) {
      this.logger.warn(`QR code generation failed: ${qrError}`);
    }

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({
          size: 'A4',
          margin: 50,
          bufferPages: true,
        });

        const chunks: Buffer[] = [];
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Draw static content
        this.drawStaticContent(doc, data);

        // Embed QR code if available
        if (qrBuffer) {
          doc.image(qrBuffer, doc.page.width - 170, 160, {
            width: 120,
            height: 120,
          });
        } else {
          doc
            .fontSize(10)
            .fillColor('#999999')
            .text('QR Code unavailable', doc.page.width - 170, 200);
        }

        // End the document after all content is drawn
        doc.end();
      } catch (error) {
        this.logger.error(`PDF generation failed: ${error}`, error);
        reject(error);
      }
    });
  }

  private async generateQrCode(retirementId: string): Promise<Buffer> {
    const auditUrl = `https://carbonledger.io/audit/retirement/${retirementId}`;
    return QRCode.toBuffer(auditUrl, {
      errorCorrectionLevel: 'H',
      type: 'png',
      width: 300,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });
  }

  private drawStaticContent(doc: PDFDocument, data: CertificateData): void {
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;

    // Background gradient effect with borders
    doc
      .rect(0, 0, pageWidth, pageHeight)
      .fillAndStroke('#f0fdf4', '#059669');

    // Decorative border
    doc
      .lineWidth(3)
      .strokeColor('#059669')
      .rect(40, 40, pageWidth - 80, pageHeight - 80)
      .stroke();

    // Header
    doc
      .fontSize(32)
      .font('Helvetica-Bold')
      .fillColor('#059669')
      .text('CARBON RETIREMENT CERTIFICATE', 50, 60, {
        align: 'center',
        width: pageWidth - 100,
      });

    doc
      .fontSize(12)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Verified Carbon Credit Retirement', 50, 110, {
        align: 'center',
        width: pageWidth - 100,
      });

    // Divider
    doc
      .moveTo(80, 140)
      .lineTo(pageWidth - 80, 140)
      .strokeColor('#059669')
      .stroke();

    // Certificate ID
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Certificate ID:', 60, 160);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(data.retirementId, 60, 178);

    // Beneficiary
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Beneficiary:', 60, 210);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(data.beneficiary, 60, 228);

    // Amount
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Carbon Credits Retired:', 60, 260);
    doc
      .fontSize(16)
      .font('Helvetica-Bold')
      .fillColor('#059669')
      .text(`${data.amount} tonnes CO\u2082e`, 60, 280);

    // Project
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Project:', 60, 320);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(data.projectName, 60, 338);

    // Retirement Reason
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Retirement Reason:', 60, 370);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(data.retirementReason, 60, 388, {
        width: pageWidth - 120,
        align: 'left',
      });

    // Serial Number Range
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Serial Number Range:', 60, 430);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(
        `${data.serialStart} \u2013 ${data.serialEnd}`,
        60,
        448
      );

    // Dates
    const retiredDate = new Date(data.retiredAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Retirement Date:', 60, 490);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(retiredDate, 60, 508);

    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Vintage Year:', 60, 540);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#333333')
      .text(String(data.vintageYear), 60, 558);

    // Transaction Hash
    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor('#000000')
      .text('Stellar Transaction Hash:', 60, 590);
    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor('#333333')
      .text(data.txHash, 60, 608, {
        width: pageWidth - 220,
      });

    // QR Code label
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#666666')
      .text(
        'Scan to verify on-chain',
        pageWidth - 170,
        290,
        { width: 120, align: 'center' }
      );

    // Digital signature block (#594) — lets a regulator or ESG auditor
    // verify this certificate offline against Stellar.toml's
    // CERTIFICATE_SIGNING_KEY, without trusting CarbonLedger's backend.
    if (data.issuerSignature && data.issuerPublicKey) {
      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text('Issuer Signature (Ed25519):', 60, 640);
      doc
        .fontSize(7)
        .font('Courier')
        .fillColor('#333333')
        .text(data.issuerSignature, 60, 658, { width: pageWidth - 120 });
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text('Signed by:', 60, 684, { continued: true })
        .font('Courier')
        .fillColor('#333333')
        .text(` ${data.issuerPublicKey}`);
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#666666')
        .text(
          `Verify offline: GET /certificates/${data.retirementId} for the signedCertificate JSON, then ` +
            'node backend/scripts/verify-certificate.js <file> Stellar.toml',
          60,
          700,
          { width: pageWidth - 120 },
        );
    }

    // Footer
    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor('#999999')
      .text(
        'This certificate verifies the permanent retirement of carbon credits on the CarbonLedger platform.',
        50,
        pageHeight - 60,
        {
          align: 'center',
          width: pageWidth - 100,
        }
      );

    doc
      .fontSize(8)
      .fillColor('#cccccc')
      .text(
        `Generated: ${new Date().toISOString()}`,
        50,
        pageHeight - 30,
        {
          align: 'center',
          width: pageWidth - 100,
        }
      );
  }
}
