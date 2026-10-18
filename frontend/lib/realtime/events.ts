/**
 * Realtime event types for WebSocket push notifications.
 *
 * These events are sent by the backend WebSocket gateway (or equivalent)
 * and consumed by the frontend WebSocket client to trigger UI updates.
 */

/** Event type constants sent by the server. */
export const RealtimeEventType = {
  CREDITS_RETIRED_CONFIRMED: "CREDITS_RETIRED_CONFIRMED",
  /** Emitted when an admin pauses a contract or marketplace listing. */
  CONTRACT_PAUSED: "CONTRACT_PAUSED",
  /** Emitted when an admin resumes a previously paused contract or listing. */
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

/**
 * Payload for a CONTRACT_PAUSED event.
 * Mirrors the fields from the PauseEvent DB model so the frontend can update
 * its local pause state without polling.
 */
export interface ContractPausedPayload {
  /** "credit" | "marketplace" */
  contract: string;
  /** Stellar public key of the admin that initiated the pause. */
  pausedBy: string;
  /** Human-readable reason for the pause; may be absent for emergency pauses. */
  reason?: string;
  /** Unix timestamp (ms) when the pause auto-expires; null means indefinite. */
  pausedUntil?: number;
  /** ISO-8601 timestamp when the pause took effect. */
  occurredAt: string;
  /** Stellar transaction hash for the pause operation. */
  txHash: string;
}

/**
 * Payload for a CONTRACT_UNPAUSED event.
 */
export interface ContractUnpausedPayload {
  /** "credit" | "marketplace" */
  contract: string;
  /** Stellar public key of the admin that resumed operations. */
  unpausedBy: string;
  /** ISO-8601 timestamp when the unpause took effect. */
  occurredAt: string;
  /** Stellar transaction hash for the unpause operation. */
  txHash: string;
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
