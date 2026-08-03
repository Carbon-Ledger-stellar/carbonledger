import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

interface EmailPayload {
  to: string;
  subject: string;
  template: string;
  data: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private transporter: nodemailer.Transporter;

  constructor() {
    // Configure email transporter
    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = process.env.SMTP_PORT;
    const smtpUser = process.env.SMTP_USER;
    const smtpPass = process.env.SMTP_PASS;

    if (smtpHost && smtpPort && smtpUser && smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(smtpPort),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });
    } else {
      this.logger.warn('SMTP not configured - notifications will be logged only');
    }
  }

  async sendCertificateReady(
    email: string,
    retirementId: string,
    certificateUrl: string,
    amount: number
  ): Promise<void> {
    try {
      const subject = `Your Carbon Retirement Certificate is Ready`;
      const html = this.renderCertificateReadyEmail(
        retirementId,
        certificateUrl,
        amount
      );

      if (this.transporter) {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'noreply@carbonledger.io',
          to: email,
          subject,
          html,
        });
        this.logger.log(`Certificate ready email sent to ${email}`);
      } else {
        this.logger.log(
          `[MOCK EMAIL] To: ${email}, Subject: ${subject}, URL: ${certificateUrl}`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send certificate email: ${error}`, error);
      throw error;
    }
  }

  async sendCertificateFailed(
    email: string,
    retirementId: string,
    reason: string
  ): Promise<void> {
    try {
      const subject = `Carbon Retirement Certificate Generation Failed`;
      const html = this.renderCertificateFailedEmail(retirementId, reason);

      if (this.transporter) {
        await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'noreply@carbonledger.io',
          to: email,
          subject,
          html,
        });
        this.logger.log(`Certificate failed email sent to ${email}`);
      } else {
        this.logger.log(
          `[MOCK EMAIL] To: ${email}, Subject: ${subject}, Reason: ${reason}`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to send failure email: ${error}`, error);
      throw error;
    }
  }

  private renderCertificateReadyEmail(
    retirementId: string,
    certificateUrl: string,
    amount: number
  ): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2 style="color: #059669;">Your Carbon Retirement Certificate is Ready</h2>
          <p>Dear User,</p>
          <p>Your carbon retirement certificate for <strong>${amount} tonnes CO₂e</strong> has been successfully generated and is now available.</p>
          <p>
            <a href="${certificateUrl}" style="display: inline-block; padding: 10px 20px; background-color: #059669; color: white; text-decoration: none; border-radius: 4px;">
              Download Certificate
            </a>
          </p>
          <p><strong>Retirement ID:</strong> ${retirementId}</p>
          <p>You can also access your certificate anytime by visiting your dashboard.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #999;">
            This is an automated message from CarbonLedger. Please do not reply to this email.
          </p>
        </body>
      </html>
    `;
  }

  private renderCertificateFailedEmail(
    retirementId: string,
    reason: string
  ): string {
    return `
      <html>
        <body style="font-family: Arial, sans-serif; color: #333;">
          <h2 style="color: #dc2626;">Certificate Generation Failed</h2>
          <p>Dear User,</p>
          <p>Unfortunately, we encountered an issue generating your carbon retirement certificate.</p>
          <p><strong>Retirement ID:</strong> ${retirementId}</p>
          <p><strong>Reason:</strong> ${reason}</p>
          <p>Our team has been notified and will investigate this issue. Please contact support if this persists.</p>
          <hr style="border: none; border-top: 1px solid #ddd; margin: 20px 0;">
          <p style="font-size: 12px; color: #999;">
            This is an automated message from CarbonLedger. Please do not reply to this email.
          </p>
        </body>
      </html>
    `;
  }
}
