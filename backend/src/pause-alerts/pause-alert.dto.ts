import { IsString, IsNotEmpty, IsDateString, IsOptional, IsEmail, MinLength } from 'class-validator';

/** Payload supplied when a contract enters emergency pause. */
export class PauseActivatedDto {
  /** Contract identifier, e.g. "carbon_credit" or "carbon_marketplace". */
  @IsString()
  @IsNotEmpty()
  contract: string;

  /**
   * Human-readable reason the pause was triggered. Must be provided; blank
   * reasons fail the `Pause Reason Required` alert rule.
   */
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Pause reason must be at least 3 characters' })
  reason: string;

  /**
   * ISO-8601 datetime until which the pause is active. The contract
   * auto-unpauses when this window elapses.
   */
  @IsDateString()
  pausedUntil: string;

  /** Stellar public key of the admin who triggered the pause. */
  @IsString()
  @IsNotEmpty()
  adminAddress: string;
}

/** Payload supplied when a contract is manually unpaused. */
export class PauseLiftedDto {
  /** Contract identifier, e.g. "carbon_credit" or "carbon_marketplace". */
  @IsString()
  @IsNotEmpty()
  contract: string;

  /** Reason the pause was lifted (e.g. "Incident resolved — CVE-2024-XXXX patched"). */
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Unpause reason must be at least 3 characters' })
  reason: string;

  /** Stellar public key of the admin who lifted the pause. */
  @IsString()
  @IsNotEmpty()
  adminAddress: string;
}

// ── Internal channel-payload types ────────────────────────────────────────────

/** Common fields shared by both Slack notification payloads. */
interface SlackBasePayload {
  contract: string;
  reason: string;
  adminAddress: string;
  timestamp: string;
}

/** Slack payload for a pause-activated notification. */
export interface SlackPausePayload extends SlackBasePayload {
  pausedUntil: string;
}

/** Slack payload for a pause-lifted notification. */
export type SlackUnpausePayload = SlackBasePayload;

/** PagerDuty Events API v2 — trigger event body. */
export interface PagerDutyTriggerPayload {
  routing_key: string;
  event_action: 'trigger';
  dedup_key: string;
  payload: {
    summary: string;
    source: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    timestamp: string;
    custom_details: Record<string, unknown>;
  };
  links?: Array<{ href: string; text: string }>;
}

/** Email audit-trail payload forwarded to MailService. */
export interface PauseEmailPayload {
  contract: string;
  action: 'activated' | 'lifted';
  reason: string;
  adminAddress: string;
  pausedUntil?: string;
  timestamp: string;
}
