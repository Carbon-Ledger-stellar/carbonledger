import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MAIL_QUEUE, MailEvent } from './mail.constants';
import { PrismaService } from '../prisma.service';

@Injectable()
export class MailService {
  constructor(
    @InjectQueue(MAIL_QUEUE) private mailQueue: Queue,
    private prisma: PrismaService,
  ) {}

  async sendEmail(to: string, event: MailEvent, payload: any) {
    const log = await this.prisma.emailLog.create({
      data: { to, template: event, subject: this.getSubject(event), status: 'Pending' },
    });
    await this.mailQueue.add(event, { logId: log.id, to, payload });
    return log;
  }

  /** Send only if the user has the corresponding preference enabled. */
  async sendIfEnabled(publicKey: string, event: MailEvent, payload: any) {
    const user = await this.prisma.user.findUnique({
      where: { publicKey },
      include: { notificationPreferences: true },
    });
    if (!user?.email || !user.isSubscribed) return null;

    const prefs = user.notificationPreferences;
    const enabled = prefs ? this.isEventEnabled(prefs, event) : true; // default: all on
    if (!enabled) return null;

    return this.sendEmail(user.email, event, payload);
  }

  private isEventEnabled(prefs: any, event: MailEvent): boolean {
    switch (event) {
      case MailEvent.PROJECT_APPROVED:    return prefs.projectApproved;
      case MailEvent.CREDITS_MINTED:      return prefs.creditsMinted;
      case MailEvent.PURCHASE_CONFIRMED:  return prefs.purchaseConfirmed;
      case MailEvent.RETIREMENT_CONFIRMED: return prefs.retirementConfirmed;
      default: return true;
    }
  }

  private getSubject(event: MailEvent): string {
    switch (event) {
      case MailEvent.PROJECT_APPROVED:    return 'Project Approved - CarbonLedger';
      case MailEvent.CREDITS_MINTED:      return 'Credits Minted Successfully';
      case MailEvent.PURCHASE_CONFIRMED:  return 'Purchase Confirmed - CarbonLedger';
      case MailEvent.RETIREMENT_CONFIRMED: return 'Retirement Confirmed & Certificate Attached';
      default: return 'Notification from CarbonLedger';
    }
  }
}
