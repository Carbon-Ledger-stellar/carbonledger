import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ContractStatusService } from './contract-status.service';
import { ContractStatusDto } from './contract-status.dto';

/**
 * Public endpoint for current contract status (#1220).
 *
 * No authentication required — this endpoint is intentionally public so that
 * frontends, indexers, and external integrators can poll it without a wallet
 * or JWT.
 *
 * GET /contract/status
 *   → 200  { is_paused, paused_at, paused_by, reason }
 */
@Controller('contract')
export class ContractStatusController {
  constructor(private readonly contractStatusService: ContractStatusService) {}

  /**
   * Returns the current contract status including pause state.
   *
   * Fields:
   *   is_paused  — true if the contract is currently paused
   *   paused_at  — ISO-8601 timestamp of the last pause action; null if not paused
   *   paused_by  — Stellar public key of the pausing admin; null if not paused
   *   reason     — free-text pause reason; null if not paused or no reason given
   */
  @Get('status')
  @HttpCode(HttpStatus.OK)
  getContractStatus(): Promise<ContractStatusDto> {
    return this.contractStatusService.getContractStatus();
  }
}
