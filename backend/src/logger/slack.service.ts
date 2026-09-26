import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

/**
 * SlackService
 *
 * Sends structured Slack notifications via incoming webhooks using Block Kit.
 *
 * Notification types:
 *  1. Deploy completed
 *  2. Error alerts (real-time, severity-aware)
 *  3. High-value transaction alerts (configurable threshold)
 *  4. Daily digest at 09:00 UTC (called by scheduler)
 *
 * Configuration:
 *  ADMIN_ALERT_WEBHOOK         — Slack incoming webhook URL
 *  SLACK_HIGH_VALUE_THRESHOLD  — Credit threshold for high-value alerts (default: 10000)
 *
 * All methods are fire-and-forget: Slack failures MUST NOT propagate to callers.
 */
@Injectable()
export class SlackService {
  private readonly logger = new Logger(SlackService.name);

  private get webhookUrl(): string | undefined {
    return process.env.ADMIN_ALERT_WEBHOOK;
  }

  private get highValueThreshold(): number {
    return parseInt(process.env.SLACK_HIGH_VALUE_THRESHOLD || '10000', 10);
  }

  // ── Public notification methods ─────────────────────────────────────────

  /**
   * Notify when a deployment completes successfully.
   * Call this from your CI/CD pipeline or admin deploy endpoint.
   */
  async notifyDeployCompleted(opts: {
    environment: string;
    version: string;
    deployedBy: string;
    commitSha?: string;
    duration?: string;
  }): Promise<void> {
    const { environment, version, deployedBy, commitSha, duration } = opts;
    await this.post({
      blocks: [
        this.header(':rocket: Deploy Completed'),
        {
          type: 'section',
          fields: [
            this.field('*Environment*', environment),
            this.field('*Version*', version),
            this.field('*Deployed by*', deployedBy),
            ...(commitSha ? [this.field('*Commit*', `\`${commitSha.slice(0, 8)}\``)] : []),
            ...(duration ? [this.field('*Duration*', duration)] : []),
          ],
        },
        this.divider(),
        this.context(`CarbonLedger Backend • ${new Date().toUTCString()}`),
      ],
    });
  }

  /**
   * Send a real-time error alert.
   */
  async notifyError(opts: {
    title: string;
    message: string;
    service?: string;
    severity?: 'critical' | 'warning' | 'info';
    context?: Record<string, unknown>;
  }): Promise<void> {
    const {
      title,
      message,
      service = 'carbonledger-backend',
      severity = 'warning',
      context,
    } = opts;

    const icon =
      severity === 'critical'
        ? ':red_circle:'
        : severity === 'warning'
        ? ':warning:'
        : ':information_source:';

    const blocks: object[] = [
      this.header(`${icon} ${severity.toUpperCase()}: ${title}`),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Service:* \`${service}\`\n\n${message}`,
        },
      },
    ];

    if (context && Object.keys(context).length > 0) {
      const lines = Object.entries(context)
        .map(([k, v]) => `• *${k}:* ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `*Context:*\n${lines}` },
      });
    }

    blocks.push(
      this.divider(),
      this.context(`CarbonLedger • ${new Date().toUTCString()}`),
    );

    await this.post({ blocks });
  }

  /**
   * Alert when a purchase or retirement exceeds the high-value threshold.
   * Silently no-ops when amount is below the threshold.
   */
  async notifyHighValueTransaction(opts: {
    type: 'purchase' | 'retirement';
    amount: number;
    buyerPublicKey: string;
    projectId?: string;
    txHash?: string;
    methodology?: string;
  }): Promise<void> {
    if (opts.amount < this.highValueThreshold) return;

    const { type, amount, buyerPublicKey, projectId, txHash, methodology } = opts;
    const icon = type === 'purchase' ? ':moneybag:' : ':recycle:';
    const label = type === 'purchase' ? 'High-Value Purchase' : 'High-Value Retirement';
    // Mask public key: first 8 chars + ellipsis + last 4 chars
    const maskedKey = `${buyerPublicKey.slice(0, 8)}…${buyerPublicKey.slice(-4)}`;

    await this.post({
      blocks: [
        this.header(`${icon} ${label}`),
        {
          type: 'section',
          fields: [
            this.field('*Amount*', `${amount.toLocaleString()} credits`),
            this.field('*Actor (masked)*', maskedKey),
            ...(projectId ? [this.field('*Project*', projectId)] : []),
            ...(methodology ? [this.field('*Methodology*', methodology)] : []),
            ...(txHash ? [this.field('*Tx Hash*', `\`${txHash.slice(0, 16)}…\``)] : []),
          ],
        },
        this.divider(),
        this.context(
          `Threshold: ≥${this.highValueThreshold.toLocaleString()} credits • ${new Date().toUTCString()}`,
        ),
      ],
    });
  }

  /**
   * Send the daily 09:00 UTC digest with platform stats.
   * Intended to be called by StatsSchedulerService (cron: 0 9 * * *).
   */
  async sendDailyDigest(stats: {
    activeListings: number;
    transactions24h: number;
    creditsRetired24h: number;
    revenueUsdc24h: number;
    newUsers24h: number;
    errors24h: number;
  }): Promise<void> {
    const {
      activeListings,
      transactions24h,
      creditsRetired24h,
      revenueUsdc24h,
      newUsers24h,
      errors24h,
    } = stats;

    const errorStatus =
      errors24h > 0
        ? `:red_circle: ${errors24h}`
        : ':white_check_mark: 0';

    await this.post({
      blocks: [
        this.header(':bar_chart: CarbonLedger Daily Digest'),
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Report for ${new Date().toDateString()} UTC*`,
          },
        },
        {
          type: 'section',
          fields: [
            this.field(':page_with_curl: Active Listings', activeListings.toLocaleString()),
            this.field(':chart_with_upwards_trend: Transactions (24h)', transactions24h.toLocaleString()),
            this.field(':recycle: Credits Retired (24h)', creditsRetired24h.toLocaleString()),
            this.field(':dollar: Revenue USDC (24h)', `$${revenueUsdc24h.toLocaleString()}`),
            this.field(':bust_in_silhouette: New Users', newUsers24h.toLocaleString()),
            this.field(':rotating_light: Errors (24h)', errorStatus),
          ],
        },
        this.divider(),
        this.context('CarbonLedger Automated Daily Digest • 09:00 UTC'),
      ],
    });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private async post(payload: object): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.warn(
        'Slack webhook not configured (ADMIN_ALERT_WEBHOOK). Skipping notification.',
      );
      return;
    }
    try {
      await axios.post(this.webhookUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 5_000,
      });
    } catch (error) {
      // Slack failures must never bubble up
      this.logger.error(
        'Failed to send Slack notification',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private header(text: string): object {
    return { type: 'header', text: { type: 'plain_text', text, emoji: true } };
  }

  private field(label: string, value: string): object {
    return { type: 'mrkdwn', text: `${label}\n${value}` };
  }

  private divider(): object {
    return { type: 'divider' };
  }

  private context(text: string): object {
    return { type: 'context', elements: [{ type: 'mrkdwn', text }] };
  }
}
