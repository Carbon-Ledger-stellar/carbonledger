/**
 * Realtime event types for WebSocket push notifications.
 *
 * These events are sent by the backend WebSocket gateway (or equivalent)
 * and consumed by the frontend WebSocket client to trigger UI updates.
 */

/** Event type constants sent by the server. */
export const RealtimeEventType = {
  CREDITS_RETIRED_CONFIRMED: "CREDITS_RETIRED_CONFIRMED",
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

/** Union of all known event payloads. */
export type RealtimeEventPayload = CreditsRetiredConfirmedPayload;

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