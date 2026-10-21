import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { MailService } from '../mail/mail.service';
import { MailEvent } from '../mail/mail.constants';
import {
  PagerDutyTriggerPayload,
  PauseEmailPayload,
  SlackPausePayload,
  SlackUnpausePayload,
} from './pause-alert.dto';

/**
 * PauseAlertService (#1367)
 *
 * Sends operational alerts whenever a Soroban contract enters or exits
 * emergency pause mode.  Each event is dispatched to three channels:
 *
 *  1. **Slack** — rich block-kit message with contract, reason, admin, and
 *     timestamps; posted via an incoming webhook URL.
 *  2. **PagerDuty** — Events API v2 `trigger` payload routed to on-call
 *     engineering (pause events only; unpause events resolve automatically
 *     via the dedup_key).
 *  3. **Email** — plain audit-trail email sent to the admin ops address via
 *     the existing MailService / BullMQ queue.
 *
 * All three channels are attempted independently; a failure in one channel
 * is logged but never allowed to propagate — alert delivery must not block
 * the main request path.
 *
 * ### Environment variables
 *
 * | Variable                     | Purpose                                     |
 * |------------------------------|---------------------------------------------|
 * | `SLACK_PAUSE_WEBHOOK_URL`    | Slack incoming webhook URL                  |
 * | `PAGERDUTY_ROUTING_KEY`      | PagerDuty Events API v2 integration key     |
 * | `PAGERDUTY_EVENTS_URL`       | PagerDuty endpoint (default shown below)    |
 * | `ADMIN_OPS_EMAIL`            | Recipient for audit-trail emails            |
 */
@Injectable()
export class PauseAlertService {
  private readonly logger = new Logger(PauseAlertService.name);

  /** Default PagerDuty Events API v2 endpoint. */
  private static readonly PAGERDUTY_DEFAULT_URL =
    'https://events.pagerduty.com/v2/enqueue';

  constructor(
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Dispatch alerts for a contract entering emergency pause.
   *
   * Channels: Slack + PagerDuty (critical) + Email.
   */
  async notifyPauseActivated(
    contract: string,
    reason: string,
    pausedUntil: Date,
    adminAddress: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const pausedUntilIso = pausedUntil.toISOString();

    this.logger.warn({
      event: 'pause_alert_dispatching',
      action: 'pause',
      contract,
      reason,
      pausedUntil: pausedUntilIso,
      adminAddress,
    });

    await Promise.allSettled([
      this.sendSlackPause({ contract, reason, pausedUntil: pausedUntilIso, adminAddress, timestamp }),
      this.sendPagerDutyTrigger(contract, reason, adminAddress, pausedUntilIso, timestamp),
      this.sendAuditEmail({
        contract,
        action: 'activated',
        reason,
        adminAddress,
        pausedUntil: pausedUntilIso,
        timestamp,
      }),
    ]);
  }

  /**
   * Dispatch alerts for a contract exiting emergency pause.
   *
   * Channels: Slack + Email.
   * PagerDuty incidents auto-resolve via dedup key when unpause is detected
   * by the monitoring layer, so we do not re-trigger here.
   */
  async notifyPauseLifted(
    contract: string,
    reason: string,
    adminAddress: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    this.logger.log({
      event: 'pause_alert_dispatching',
      action: 'unpause',
      contract,
      reason,
      adminAddress,
    });

    await Promise.allSettled([
      this.sendSlackUnpause({ contract, reason, adminAddress, timestamp }),
      this.sendAuditEmail({
        contract,
        action: 'lifted',
        reason,
        adminAddress,
        timestamp,
      }),
    ]);
  }

  // ── Slack ───────────────────────────────────────────────────────────────────

  private async sendSlackPause(payload: SlackPausePayload): Promise<void> {
    const webhookUrl = this.config.get<string>('SLACK_PAUSE_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn('SLACK_PAUSE_WEBHOOK_URL not configured — skipping Slack notification');
      return;
    }

    const body = {
      text: `🚨 *EMERGENCY PAUSE ACTIVATED* — \`${payload.contract}\``,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '🚨 Emergency Pause Activated', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Contract:*\n\`${payload.contract}\`` },
            { type: 'mrkdwn', text: `*Paused Until:*\n${payload.pausedUntil}` },
            { type: 'mrkdwn', text: `*Reason:*\n${payload.reason}` },
            { type: 'mrkdwn', text: `*Admin:*\n\`${payload.adminAddress}\`` },
          ],
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Triggered at ${payload.timestamp} · CarbonLedger` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':rotating_light: *On-call engineers have been paged via PagerDuty.* Immediate investigation required.',
          },
        },
      ],
    };

    await this.postSlack(webhookUrl, body, 'pause');
  }

  private async sendSlackUnpause(payload: SlackUnpausePayload): Promise<void> {
    const webhookUrl = this.config.get<string>('SLACK_PAUSE_WEBHOOK_URL');
    if (!webhookUrl) {
      this.logger.warn('SLACK_PAUSE_WEBHOOK_URL not configured — skipping Slack notification');
      return;
    }

    const body = {
      text: `✅ *PAUSE LIFTED* — \`${payload.contract}\``,
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '✅ Contract Pause Lifted', emoji: true },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Contract:*\n\`${payload.contract}\`` },
            { type: 'mrkdwn', text: `*Lifted At:*\n${payload.timestamp}` },
            { type: 'mrkdwn', text: `*Reason:*\n${payload.reason}` },
            { type: 'mrkdwn', text: `*Admin:*\n\`${payload.adminAddress}\`` },
          ],
        },
        {
          type: 'context',
          elements: [
            { type: 'mrkdwn', text: `Resolved at ${payload.timestamp} · CarbonLedger` },
          ],
        },
      ],
    };

    await this.postSlack(webhookUrl, body, 'unpause');
  }

  private async postSlack(url: string, body: unknown, context: string): Promise<void> {
    try {
      await axios.post(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5_000,
      });
      this.logger.log(`Slack ${context} alert sent successfully`);
    } catch (err: unknown) {
      this.logger.error(`Failed to send Slack ${context} alert`, err instanceof Error ? err.message : err);
    }
  }

  // ── PagerDuty ───────────────────────────────────────────────────────────────

  private async sendPagerDutyTrigger(
    contract: string,
    reason: string,
    adminAddress: string,
    pausedUntil: string,
    timestamp: string,
  ): Promise<void> {
    const routingKey = this.config.get<string>('PAGERDUTY_ROUTING_KEY');
    if (!routingKey) {
      this.logger.warn('PAGERDUTY_ROUTING_KEY not configured — skipping PagerDuty notification');
      return;
    }

    const eventsUrl =
      this.config.get<string>('PAGERDUTY_EVENTS_URL') ??
      PauseAlertService.PAGERDUTY_DEFAULT_URL;

    /**
     * Dedup key is deterministic per contract so that the on-call incident
     * can be resolved by the monitoring layer when the unpause alert fires,
     * without creating a second incident.
     */
    const dedupKey = `carbonledger-pause-${contract}`;

    const payload: PagerDutyTriggerPayload = {
      routing_key: routingKey,
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: `[CarbonLedger] EMERGENCY PAUSE — ${contract}: ${reason}`,
        source: 'carbonledger-backend',
        severity: 'critical',
        timestamp,
        custom_details: {
          contract,
          reason,
          pausedUntil,
          adminAddress,
          runbook: 'https://github.com/carbonledger/carbonledger/blob/main/docs/runbooks/emergency-pause.md',
        },
      },
      links: [
        {
          href: `https://carbonledger.io/admin/pause?contract=${encodeURIComponent(contract)}`,
          text: 'Admin Pause Dashboard',
        },
      ],
    };

    try {
      await axios.post(eventsUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10_000,
      });
      this.logger.warn(`PagerDuty incident triggered for contract ${contract} (dedup: ${dedupKey})`);
    } catch (err: unknown) {
      this.logger.error('Failed to trigger PagerDuty incident', err instanceof Error ? err.message : err);
    }
  }

  // ── Email ───────────────────────────────────────────────────────────────────

  private async sendAuditEmail(payload: PauseEmailPayload): Promise<void> {
    const adminEmail =
      this.config.get<string>('ADMIN_OPS_EMAIL') ??
      this.config.get<string>('ADMIN_ALERT_EMAIL');

    if (!adminEmail) {
      this.logger.warn('ADMIN_OPS_EMAIL not configured — skipping audit-trail email');
      return;
    }

    try {
      await this.mail.sendEmail(adminEmail, MailEvent.ERROR_ALERT, {
        errorTitle:
          payload.action === 'activated'
            ? `[AUDIT] Contract Pause Activated — ${payload.contract}`
            : `[AUDIT] Contract Pause Lifted — ${payload.contract}`,
        errorMessage: this.buildAuditEmailBody(payload),
        timestamp: payload.timestamp,
        service: 'carbonledger-pause-monitor',
      });
      this.logger.log(`Audit-trail email queued for ${payload.action} event on ${payload.contract}`);
    } catch (err: unknown) {
      this.logger.error('Failed to enqueue audit-trail email', err instanceof Error ? err.message : err);
    }
  }

  private buildAuditEmailBody(payload: PauseEmailPayload): string {
    const lines: string[] = [
      `Contract Pause Audit Trail`,
      `==========================`,
      ``,
      `Action:       ${payload.action === 'activated' ? 'PAUSE ACTIVATED' : 'PAUSE LIFTED'}`,
      `Contract:     ${payload.contract}`,
      `Reason:       ${payload.reason}`,
      `Admin:        ${payload.adminAddress}`,
      `Timestamp:    ${payload.timestamp}`,
    ];

    if (payload.pausedUntil) {
      lines.push(`Paused Until: ${payload.pausedUntil}`);
    }

    lines.push(
      ``,
      `This is an automated audit-trail message from CarbonLedger.`,
      `Do not reply to this email.`,
    );

    return lines.join('\n');
  }
}
