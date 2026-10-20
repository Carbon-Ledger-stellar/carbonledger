/**
 * Response shape for GET /contract/status (#1220).
 *
 * Returns the current on-chain pause state for the primary contract
 * (carbon_credit) together with audit trail fields pulled from the most recent
 * PauseEvent row.  All fields are always present; nullable fields are null
 * when the contract is not currently paused.
 */
export class ContractStatusDto {
  /** Whether the contract is currently paused. */
  is_paused: boolean;

  /**
   * ISO-8601 timestamp of the most recent pause action.
   * null when the contract has never been paused or is currently unpaused.
   */
  paused_at: string | null;

  /**
   * Stellar public key of the admin that triggered the most recent pause.
   * null when the contract has never been paused or is currently unpaused.
   */
  paused_by: string | null;

  /**
   * Free-text reason provided by the admin when pausing.
   * null when no reason was given, or when the contract is currently unpaused.
   */
  reason: string | null;
}
