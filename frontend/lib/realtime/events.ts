/**
 * Realtime event types for WebSocket push notifications.
 *
 * These events are sent by the backend WebSocket gateway (or equivalent)
 * and consumed by the frontend WebSocket client to trigger UI updates.
 */

/** Event type constants sent by the server. */
export const RealtimeEventType = {
  CREDITS_RETIRED_CONFIRMED: "CREDITS_RETIRED_CONFIRMED",
  /** Fired when a Soroban contract is paused by an admin (#1253). */
  CONTRACT_PAUSED: "CONTRACT_PAUSED",
  /** Fired when a Soroban contract resumes normal operation (#1253). */
  CONTRACT_UNPAUSED: "CONTRACT_UNPAUSED",
} as const;

export type RealtimeEventType =
  (typeof RealtimeEventType)[keyof typeof RealtimeEventType];

/** Payload for a CREDITS_RETIRED_CONFIRMED event. */
export interface CreditsRetiredConfirmedPayload {
  /** The on-chain transaction hash. */
  txHash: string;
  /** Amount of credits retired (in tonnes CO₂e). */
  amount: number;
  /** Beneficiary name. */
  beneficiary: string;
  /** ISO-8601 timestamp of the retirement. */
  retiredAt: string;
}

/** Payload for a CONTRACT_PAUSED event (#1253). */
export interface ContractPausedPayload {
  /** Human-readable contract name, e.g. "carbon_credit". */
  contract: string;
  /** On-chain Soroban contract ID. */
  contractId: string;
  /** Human-readable reason supplied by the admin, if any. */
  reason?: string | null;
  /** ISO-8601 string of when the pause auto-expires, if applicable. */
  pausedUntil?: string | null;
  /** ISO-8601 timestamp of when the status changed. */
  changedAt: string;
}

/** Payload for a CONTRACT_UNPAUSED event (#1253). */
export interface ContractUnpausedPayload {
  /** Human-readable contract name, e.g. "carbon_credit". */
  contract: string;
  /** On-chain Soroban contract ID. */
  contractId: string;
  /** ISO-8601 timestamp of when the status changed. */
  changedAt: string;
}

/** Union of all known event payloads. */
export type RealtimeEventPayload =
  | CreditsRetiredConfirmedPayload
  | ContractPausedPayload
  | ContractUnpausedPayload;

/** A parsed event delivered by the WebSocket connection. */
export interface RealtimeEvent {
  type: RealtimeEventType;
  payload: RealtimeEventPayload;
}

/** WebSocket message shape sent from the server. */
export interface ServerMessage {
  /** When absent, the message is a subscription acknowledgement. */
  event?: RealtimeEvent;
  /** Optional error information. */
  error?: string;
}

/** Subscription message sent to the server after connecting. */
export interface SubscribeMessage {
  type: "subscribe";
  channels: string[];
}