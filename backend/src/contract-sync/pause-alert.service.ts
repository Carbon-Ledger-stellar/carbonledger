import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma.service';
import { MailService } from '../mail/mail.service';
import { WebhookService } from '../webhook/webhook.service';
import { PauseStatusChangedEvent } from '../contract-sync/contract-state-sync.service';

/**
 * Notification channels supported by PauseAlertService.
 * Each channel can be enabled/disabled via environment variables.
 */
export type AlertChannel = 'email' | 'slack' | 'webhook';

/**
 * Minimum seconds between alerts for the same contract.
 * Prevents notification spam during rapid pause/unpause cycles.
 * Default: 5 minutes.
 */
const DEFAULT_COOLDOWN_SECONDS = 5 * 60;

/**
 * PauseAlertService — sends ops-team notifications when a contract's pause
 * status changes (#1229).
 *
 * Features:
 *   - Listens for `pause.status.changed` events from ContractStateSyncService.
 *   - Dispatches notifications over all configured channels (email, Slack,
 *     webhook) concurrently.
 *   - Enforces a per-contract cooldown window to prevent notification spam.
 *   - Logs every alert attempt (sent / failed / skipped) to `PauseAlertLog`.
 *   - Never throws — alert failures must never break the main request path.
 *
 * Configuration (via environment variables):
 *   PAUSE_ALERT_EMAIL          — comma-separated ops email addresses
 *   PAUSE_ALERT_SLACK_WEBHOOK  — Slack incoming-webhook URL
 *   PAUSE_ALERT_WEBHOOK_URL    — custom webhook URL (receives the same payload
 *                                that the WebhookService dispatches)
 *   PAUSE_ALERT_COOLDOWN_SECS  — override the default 300-second cooldown
 */
@Injectable()
export class PauseAlertService implements OnModuleInit {
  private readonly logger = new Logger(PauseAlertService.name);

  private readonly cooldownSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly webhookService: WebhookService,
  ) {
    this.cooldownSeconds =
      Number(process.env.PAUSE_ALERT_COOLDOWN_SECS) || DEFAULT_COOLDOWN_SECONDS;
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(
      `PauseAlertService ready — cooldown: ${this.cooldownSeconds}s`,
    );
  }

  /**
   * Handles PauseStatusChangedEvent emitted by ContractStateSyncService.
   * The method is async but swallows all errors so alert failures never
   * propagate to the event bus.
   */
  @OnEvent('pause.status.changed')
  async handlePauseStatusChanged(event: PauseStatusChangedEvent): Promise<void> {
    try {
      await this.sendAlerts(event);
    } catch (err) {
      this.logger.error(
        `Unexpected error while processing pause alert for ${event.contractName}: ${err}`,
      );
    }
  }

  /**
   * Public entry point for admin-triggered alerts (e.g., from PauseService).
   * Accepts the same shape as PauseStatusChangedEvent but allows an explicit
   * reason string that the sync service does not provide.
   */
  async notifyPauseChange(params: {
    contractName: string;
    contractId: string;
    isPaused: boolean;
    reason?: string | null;
    pausedUntil?: Date | null;
    changedAt?: Date;
  }): Promise<void> {
    const event = new PauseStatusChangedEvent(
      params.contractName as any,
      params.contractId,
      params.isPaused,
      params.reason,
      params.pausedUntil,
      params.changedAt ?? new Date(),
    );
    await this.sendAlerts(event);
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private async sendAlerts(event: PauseStatusChangedEvent): Promise<void> {
    const action = event.isPaused ? 'pause' : 'unpause';
    const { contractId, contractName } = event;

    // Check cooldown before dispatching anything.
    if (await this.isInCooldown(contractId)) {
      this.logger.log(
        `Cooldown active for ${contractName} — skipping ${action} alert`,
      );
      await this.logAlert({
        contractId,
        contractName,
        action,
        channel: 'email',
        status: 'skipped_cooldown',
        reason: event.reason,
        pausedUntil: event.pausedUntil,
      });
      return;
    }

    const channels = this.getEnabledChannels();
    if (channels.length === 0) {
      this.logger.warn(
        'No alert channels configured — set PAUSE_ALERT_EMAIL, ' +
        'PAUSE_ALERT_SLACK_WEBHOOK, or PAUSE_ALERT_WEBHOOK_URL',
      );
      return;
    }

    // Dispatch to all channels concurrently; errors are caught per-channel.
    await Promise.all(
      channels.map((ch) => this.dispatchToChannel(ch, event, action)),
    );
  }

  private async dispatchToChannel(
    channel: AlertChannel,
    event: PauseStatusChangedEvent,
    action: 'pause' | 'unpause',
  ): Promise<void> {
    const { contractId, contractName, reason, pausedUntil } = event;
    try {
      switch (channel) {
        case 'email':
          await this.sendEmailAlert(event, action);
          break;
        case 'slack':
          await this.sendSlackAlert(event, action);
          break;
        case 'webhook':
          await this.sendWebhookAlert(event, action);
          break;
      }
      await this.logAlert({
        contractId,
        contractName,
        action,
        channel,
        status: 'sent',
        reason,
        pausedUntil,
        recipient: this.getChannelRecipient(channel),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send ${channel} alert for ${contractName}: ${errMsg}`);
      await this.logAlert({
        contractId,
        contractName,
        action,
        channel,
        status: 'failed',
        reason,
        pausedUntil,
        recipient: this.getChannelRecipient(channel),
        error: errMsg,
      });
    }
  }

  // ── Email ─────────────────────────────────────────────────────────────────

  private async sendEmailAlert(
    event: PauseStatusChangedEvent,
    action: 'pause' | 'unpause',
  ): Promise<void> {
    const emails = this.getEmailRecipients();
    if (emails.length === 0) return;

    const subject =
      action === 'pause'
        ? `[ALERT] Contract ${event.contractName} PAUSED`
        : `[INFO] Contract ${event.contractName} RESUMED`;

    const body = this.buildAlertMessage(event, action);

    await Promise.all(
      emails.map((email) =>
        this.mailService.sendAdminAlert(subject, body, `pause-alert:${event.contractName}`),
      ),
    );
  }

  // ── Slack ─────────────────────────────────────────────────────────────────

  private async sendSlackAlert(
    event: PauseStatusChangedEvent,
    action: 'pause' | 'unpause',
  ): Promise<void> {
    const webhookUrl = process.env.PAUSE_ALERT_SLACK_WEBHOOK;
    if (!webhookUrl) return;

    const emoji = action === 'pause' ? '🚨' : '✅';
    const color = action === 'pause' ? '#dc2626' : '#16a34a';
    const title =
      action === 'pause'
        ? `Contract Paused: ${event.contractName}`
        : `Contract Resumed: ${event.contractName}`;

    const payload = {
      attachments: [
        {
          color,
          title: `${emoji} ${title}`,
          fields: [
            { title: 'Contract', value: event.contractName, short: true },
            { title: 'Contract ID', value: event.contractId, short: true },
            { title: 'Action', value: action.toUpperCase(), short: true },
            ...(event.reason
              ? [{ title: 'Reason', value: event.reason, short: false }]
              : []),
            ...(event.pausedUntil && action === 'pause'
              ? [
                  {
                    title: 'Pause Expires',
                    value: event.pausedUntil.toISOString(),
                    short: true,
                  },
                ]
              : []),
            {
              title: 'Timestamp',
              value: event.changedAt.toISOString(),
              short: true,
            },
          ],
          footer: 'CarbonLedger Ops Alert',
          ts: Math.floor(event.changedAt.getTime() / 1000),
        },
      ],
    };

    // Use native fetch (Node 18+) — no extra dependency needed.
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Slack webhook returned ${response.status}: ${await response.text()}`,
      );
    }
  }

  // ── Custom webhook ────────────────────────────────────────────────────────

  private async sendWebhookAlert(
    event: PauseStatusChangedEvent,
    action: 'pause' | 'unpause',
  ): Promise<void> {
    const eventType =
      action === 'pause' ? 'contract.paused' : 'contract.unpaused';

    // Dispatch via the existing WebhookService so delivery logs, retries, and
    // subscription routing are handled consistently.
    await this.webhookService.dispatch(eventType as any, {
      contract: event.contractName,
      contractId: event.contractId,
      action,
      reason: event.reason ?? null,
      pausedUntil: event.pausedUntil?.toISOString() ?? null,
      changedAt: event.changedAt.toISOString(),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildAlertMessage(
    event: PauseStatusChangedEvent,
    action: 'pause' | 'unpause',
  ): string {
    const lines: string[] = [
      `Contract: ${event.contractName}`,
      `Contract ID: ${event.contractId}`,
      `Action: ${action.toUpperCase()}`,
      `Timestamp: ${event.changedAt.toISOString()}`,
    ];
    if (event.reason) lines.push(`Reason: ${event.reason}`);
    if (event.pausedUntil && action === 'pause') {
      lines.push(`Pause expires: ${event.pausedUntil.toISOString()}`);
    }
    lines.push(
      '',
      'This is an automated alert from CarbonLedger.',
      'To investigate, check the admin dashboard or audit log.',
    );
    return lines.join('\n');
  }

  private getEnabledChannels(): AlertChannel[] {
    const channels: AlertChannel[] = [];
    if (this.getEmailRecipients().length > 0) channels.push('email');
    if (process.env.PAUSE_ALERT_SLACK_WEBHOOK) channels.push('slack');
    if (process.env.PAUSE_ALERT_WEBHOOK_URL) channels.push('webhook');
    return channels;
  }

  private getEmailRecipients(): string[] {
    const raw = process.env.PAUSE_ALERT_EMAIL ?? '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private getChannelRecipient(channel: AlertChannel): string {
    switch (channel) {
      case 'email':
        return process.env.PAUSE_ALERT_EMAIL ?? '';
      case 'slack':
        return process.env.PAUSE_ALERT_SLACK_WEBHOOK ?? '';
      case 'webhook':
        return process.env.PAUSE_ALERT_WEBHOOK_URL ?? '';
    }
  }

  /**
   * Returns true if a non-cooldown alert was sent for this contract within
   * the configured cooldown window.
   */
  private async isInCooldown(contractId: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - this.cooldownSeconds * 1_000);
    const recent = await this.prisma.pauseAlertLog.findFirst({
      where: {
        contractId,
        status: { in: ['sent'] },
        sentAt: { gte: cutoff },
      },
      orderBy: { sentAt: 'desc' },
    });
    return recent !== null;
  }

  private async logAlert(data: {
    contractId: string;
    contractName: string;
    action: 'pause' | 'unpause';
    channel: AlertChannel;
    status: 'sent' | 'failed' | 'skipped_cooldown';
    reason?: string | null;
    pausedUntil?: Date | null;
    recipient?: string;
    error?: string;
  }): Promise<void> {
    try {
      await this.prisma.pauseAlertLog.create({
        data: {
          contractId: data.contractId,
          contractName: data.contractName,
          action: data.action,
          channel: data.channel,
          recipient: data.recipient ?? null,
          reason: data.reason ?? null,
          pausedUntil: data.pausedUntil ?? null,
          status: data.status,
          error: data.error ?? null,
        },
      });
    } catch (err) {
      // Log write failure must never propagate — we'd create infinite loops.
      this.logger.error(`Failed to persist pause alert log: ${err}`);
    }
  }
}
