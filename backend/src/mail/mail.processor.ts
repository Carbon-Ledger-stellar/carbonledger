import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MAIL_QUEUE, MailEvent } from './mail.constants';
import { PrismaService } from '../prisma.service';
import { PdfService } from './pdf.service';
import * as fs from 'fs/promises';
import * as path from 'path';

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  constructor(
    private prisma: PrismaService,
    private pdfService: PdfService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { logId, to, payload } = job.data;
    const event = job.name as MailEvent;

    try {
      // 1. Generate HTML from template
      const html = await this.renderTemplate(event, payload);

      // 2. Handle attachments (PDF certificate for retirement)
      let attachments = [];
      if (event === MailEvent.RETIREMENT_CONFIRMED) {
        const pdfBuffer = await this.pdfService.generateRetirementCertificate(payload);
        attachments.push({
          content: pdfBuffer.toString('base64'),
          filename: 'Retirement-Certificate.pdf',
          type: 'application/pdf',
          disposition: 'attachment',
        });
      }

      // 3. Send via provider (Mocking SendGrid/SES logic)
      console.log(`Sending email to ${to} for event ${event}`);
      // await this.provider.send({ to, from: process.env.EMAIL_FROM, html, attachments });

      // 4. Update log status
      await this.prisma.emailLog.update({
        where: { id: logId },
        data: { status: 'Sent', sentAt: new Date() },
      });

    } catch (error) {
      console.error(`Failed to send email ${logId}:`, error);
      await this.prisma.emailLog.update({
        where: { id: logId },
        data: { status: 'Failed', error: error.message },
      });
      throw error;
    }
  }

  private async renderTemplate(event: MailEvent, payload: any): Promise<string> {
    const templatePath = path.join(__dirname, 'templates', `${event.toLowerCase().replace(/_/g, '-')}.html`);
    let html = '';
    try {
      html = await fs.readFile(templatePath, 'utf8');
    } catch (err) {
      // Fallback if file not found
      html = `<h1>${event}</h1><p>Data: ${JSON.stringify(payload)}</p>`;
    }

    // Basic string replacement for demo purposes
    Object.keys(payload).forEach(key => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      html = html.replace(regex, payload[key]);
    });

    // Add unsubscribe link
    const unsubscribeLink = `${process.env.FRONTEND_URL}/unsubscribe?email=${encodeURIComponent(payload.to || '')}`;
    html = html.replace('{{unsubscribe_link}}', unsubscribeLink);

    return html;
  }
}
