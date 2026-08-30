import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AnalyticsEvent, UserTraits } from './analytics.constants';
import axios from 'axios';

/**
 * AnalyticsService
 *
 * Tracks key user behaviour events for CarbonLedger.
 *
 * Provider routing (checked at startup):
 *  1. Segment — when SEGMENT_WRITE_KEY is set  (preferred)
 *  2. Mixpanel — when MIXPANEL_TOKEN is set     (fallback)
 *  3. No-op   — when neither is configured      (dev / test)
 *
 * All methods are fire-and-forget: analytics failures MUST NOT
 * propagate to the caller.
 *
 * GDPR:
 *  - publicKey is hashed (SHA-256) before transmission.
 *  - No PII (email, name) is ever sent to third-party providers.
 *  - Users can be deleted from Segment via the `deleteUser` method.
 */
@Injectable()
export class AnalyticsService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsService.name);
  private provider: 'segment' | 'mixpanel' | 'none' = 'none';

  onModuleInit() {
    if (process.env.SEGMENT_WRITE_KEY) {
      this.provider = 'segment';
      this.logger.log('Analytics provider: Segment');
    } else if (process.env.MIXPANEL_TOKEN) {
      this.provider = 'mixpanel';
      this.logger.log('Analytics provider: Mixpanel');
    } else {
      this.logger.warn('No analytics provider configured (SEGMENT_WRITE_KEY / MIXPANEL_TOKEN). Events will be logged only.');
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Identify a user and set their traits.
   * Called on signup / login so that subsequent track() calls are enriched.
   */
  identify(userId: string, traits: UserTraits = {}): void {
    const hashedId = this.hashId(userId);
    this.dispatch(() => this.sendIdentify(hashedId, traits)).catch(() => {/* swallow */});
  }

  /**
   * Track a discrete event.
   *
   * @param userId     Stellar public key of the actor (will be hashed)
   * @param event      One of the AnalyticsEvent enum values
   * @param properties Arbitrary event-specific properties (no PII)
   */
  track(userId: string, event: AnalyticsEvent, properties: Record<string, unknown> = {}): void {
    const hashedId = this.hashId(userId);
    const enriched = {
      ...properties,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
    };
    this.dispatch(() => this.sendTrack(hashedId, event, enriched)).catch(() => {/* swallow */});
  }

  /**
   * Track a page view.
   * Convenience wrapper around `track`.
   */
  page(userId: string, pageName: string, properties: Record<string, unknown> = {}): void {
    this.track(userId, AnalyticsEvent.PAGE_VIEWED, { page: pageName, ...properties });
  }

  /**
   * GDPR: delete a user's data from Segment.
   * No-op for Mixpanel (use Mixpanel Data Deletion API manually).
   */
  async deleteUser(userId: string): Promise<void> {
    if (this.provider !== 'segment') return;
    const hashedId = this.hashId(userId);
    try {
      await axios.post(
        `https://platform.segmentapis.com/v1beta/workspaces/${process.env.SEGMENT_WORKSPACE_SLUG}/regulations`,
        {
          regulationType: 'DELETE',
          subjectType: 'USER_ID',
          subjectIds: [hashedId],
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.SEGMENT_ACCESS_TOKEN || process.env.SEGMENT_WRITE_KEY}`,
            'Content-Type': 'application/json',
          },
        },
      );
      this.logger.log(`GDPR delete requested for user ${hashedId}`);
    } catch (err) {
      this.logger.error('Failed to submit GDPR deletion request', err instanceof Error ? err.message : String(err));
    }
  }

  // ── Provider implementations ──────────────────────────────────────────────

  private async sendIdentify(hashedId: string, traits: UserTraits): Promise<void> {
    if (this.provider === 'segment') {
      await axios.post(
        'https://api.segment.io/v1/identify',
        {
          userId: hashedId,
          traits: {
            role: traits.role,
            createdAt: traits.createdAt,
            // Never include email or publicKey in plaintext
          },
        },
        { auth: { username: process.env.SEGMENT_WRITE_KEY!, password: '' } },
      );
    } else if (this.provider === 'mixpanel') {
      await axios.post(
        'https://api.mixpanel.com/engage#profile-set',
        [{ $token: process.env.MIXPANEL_TOKEN, $distinct_id: hashedId, $set: { role: traits.role } }],
      );
    }
  }

  private async sendTrack(
    hashedId: string,
    event: AnalyticsEvent,
    properties: Record<string, unknown>,
  ): Promise<void> {
    if (this.provider === 'segment') {
      await axios.post(
        'https://api.segment.io/v1/track',
        { userId: hashedId, event, properties },
        { auth: { username: process.env.SEGMENT_WRITE_KEY!, password: '' } },
      );
    } else if (this.provider === 'mixpanel') {
      const payload = {
        event,
        properties: {
          token: process.env.MIXPANEL_TOKEN,
          distinct_id: hashedId,
          ...properties,
        },
      };
      await axios.post(
        `https://api.mixpanel.com/track`,
        [payload],
        { headers: { 'Content-Type': 'application/json' } },
      );
    } else {
      // Dev / no-op: just log so developers can see events locally
      this.logger.debug(`[analytics] ${event}`, { userId: hashedId, properties });
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * One-way SHA-256 hash of the Stellar public key.
   * This allows us to correlate events without storing PII on third-party servers.
   */
  private hashId(userId: string): string {
    const { createHash } = require('crypto');
    return createHash('sha256').update(userId).digest('hex');
  }

  /**
   * Fire-and-forget wrapper: wraps an async fn so errors are logged but never thrown.
   */
  private async dispatch(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.logger.warn('Analytics dispatch failed (non-blocking)', err instanceof Error ? err.message : String(err));
    }
  }
}
