import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MAIL_QUEUE, MailEvent } from './mail.constants';
import { PrismaService } from '../prisma.service';
import { PdfService } from './pdf.service';
import { LoggerService } from '../logger/logger.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as nodemailer from 'nodemailer';
import axios from 'axios';

interface EmailAttachment {
  content: string;
  filename: string;
  type: string;
  disposition: string;
}

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
    private logger: LoggerService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { logId, to, payload } = job.data;
    const event = job.name as MailEvent;

    try {
      // 1. Generate HTML from template
      const html = await this.renderTemplate(event, payload);

      // 2. Build subject line
      const subject = this.getSubject(event);

      // 3. Handle attachments (PDF certificate for retirement)
      const attachments: EmailAttachment[] = [];
      if (event === MailEvent.RETIREMENT_CONFIRMED) {
        const pdfBuffer = await this.pdfService.generateRetirementCertificate(payload);
        attachments.push({
          content: pdfBuffer.toString('base64'),
          filename: 'Retirement-Certificate.pdf',
          type: 'application/pdf',
          disposition: 'attachment',
        });
      }

      // 4. Send via configured provider
      await this.sendViaProvider(to, subject, html, attachments);

      this.logger.log(`Email sent to ${to} for event ${event}`, { logId, to, event });

      // 5. Update log status
      await this.prisma.emailLog.update({
        where: { id: logId },
        data: { status: 'Sent', sentAt: new Date() },
      });

    } catch (error) {
      this.logger.error(
        `Failed to send email ${logId}`,
        error instanceof Error ? error.stack : String(error),
        { logId, to, event, error: error instanceof Error ? error.message : String(error) },
      );
      await this.prisma.emailLog.update({
        where: { id: logId },
        data: { status: 'Failed', error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  // ── Provider routing ───────────────────────────────────────────────────────

  /**
   * Send via SendGrid (preferred) when SENDGRID_API_KEY is set,
   * otherwise fall back to SMTP (AWS SES / any SMTP relay).
   */
  private async sendViaProvider(
    to: string,
    subject: string,
    html: string,
    attachments: EmailAttachment[],
  ): Promise<void> {
    if (process.env.SENDGRID_API_KEY) {
      return this.sendViaSendGrid(to, subject, html, attachments);
    }
    if (process.env.SMTP_HOST) {
      return this.sendViaSmtp(to, subject, html, attachments);
    }
    // No provider configured — log only (useful in test/dev)
    this.logger.log('No email provider configured; skipping send', { to, subject });
  }

  /** Send via SendGrid v3 Mail Send API. */
  private async sendViaSendGrid(
    to: string,
    subject: string,
    html: string,
    attachments: EmailAttachment[],
  ): Promise<void> {
    const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@carbonledger.io';
    const body: Record<string, unknown> = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: 'text/html', value: html }],
    };

    if (attachments.length > 0) {
      body.attachments = attachments.map((a) => ({
        content: a.content,
        filename: a.filename,
        type: a.type,
        disposition: a.disposition,
      }));
    }

    await axios.post('https://api.sendgrid.com/v3/mail/send', body, {
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /** Send via SMTP (AWS SES SMTP endpoint or any relay). */
  private async sendViaSmtp(
    to: string,
    subject: string,
    html: string,
    attachments: EmailAttachment[],
  ): Promise<void> {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });

    const from = process.env.EMAIL_FROM || process.env.SMTP_FROM || 'noreply@carbonledger.io';

    await transporter.sendMail({
      from,
      to,
      subject,
      html,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content, 'base64'),
        contentType: a.type,
      })),
    });
  }

  // ── Template rendering ─────────────────────────────────────────────────────

  private async renderTemplate(event: MailEvent, payload: any): Promise<string> {
    const templatePath = path.join(
      __dirname,
      'templates',
      `${event.toLowerCase().replace(/_/g, '-')}.html`,
    );
    let html = '';
    try {
      html = await fs.readFile(templatePath, 'utf8');
    } catch {
      html = `<h1>${event}</h1><p>Data: ${JSON.stringify(payload)}</p>`;
    }

    // Substitute all {{key}} placeholders
    Object.keys(payload).forEach((key) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      html = html.replace(regex, String(payload[key] ?? ''));
    });

    // Inject unsubscribe link
    const unsubscribeBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    const unsubscribeLink = `${unsubscribeBase}/unsubscribe?email=${encodeURIComponent(payload.to || '')}`;
    html = html.replace(/{{unsubscribe_link}}/g, unsubscribeLink);

    return html;
  }

  private getSubject(event: MailEvent): string {
    const subjects: Record<MailEvent, string> = {
      [MailEvent.PROJECT_APPROVED]:     'Project Approved — CarbonLedger',
      [MailEvent.CREDITS_MINTED]:       'Credits Minted Successfully — CarbonLedger',
      [MailEvent.PURCHASE_CONFIRMED]:   'Purchase Confirmed — CarbonLedger',
      [MailEvent.RETIREMENT_CONFIRMED]: 'Retirement Confirmed & Certificate Attached — CarbonLedger',
      [MailEvent.WELCOME]:              'Welcome to CarbonLedger 🌿',
      [MailEvent.ERROR_ALERT]:          '[ALERT] CarbonLedger Error Notification',
    };
    return subjects[event] ?? 'Notification from CarbonLedger';
  }
}
