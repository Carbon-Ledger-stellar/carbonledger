import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * ContractStateDto — API response shape for contract pause state (#1219).
 *
 * Returned by GET /admin/contracts/:contract/pause.
 *
 * The `is_paused` field is the canonical, API-layer representation of the
 * on-chain pause flag. It defaults to `false` and is read-only — clients
 * cannot set it directly; it is derived from the AdminConfig state written
 * by PauseService after a successful Soroban contract call.
 */
export class ContractStateDto {
  /**
   * The internal contract name (e.g. "carbon_credit" or "carbon_marketplace").
   * Identifies which Soroban contract this state record belongs to.
   */
  @ApiProperty({
    description: 'Internal name of the Soroban contract.',
    example: 'carbon_credit',
  })
  contract: string;

  /**
   * Whether the contract is currently paused.
   *
   * Defaults to `false`. This field is **read-only** in API responses —
   * use POST /admin/contracts/:contract/pause or POST /admin/pause to
   * change the pause state.
   */
  @ApiProperty({
    description:
      'Indicates whether the contract is currently paused. ' +
      'Defaults to false. Read-only — use the pause/unpause endpoints to change this value.',
    example: false,
    default: false,
    readOnly: true,
    type: Boolean,
  })
  is_paused: boolean = false;

  /**
   * Unix timestamp (seconds) until which the contract will remain paused.
   * `null` when the contract is not paused.
   */
  @ApiPropertyOptional({
    description:
      'Unix timestamp (seconds) until which the contract remains paused. ' +
      'Null when the contract is not paused.',
    example: 1729468800,
    nullable: true,
    type: Number,
  })
  pausedUntil: number | null;
}
