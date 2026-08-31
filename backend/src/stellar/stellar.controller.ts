import {
  Controller,
  Post,
  Body,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { Public } from '../auth/decorators';
import { FaucetService, FaucetFundResult } from '../common/faucet.service';

class FundAccountDto {
  @IsString()
  publicKey: string;
}

/**
 * StellarController — Testnet utilities
 *
 * Exposes endpoints for Stellar testnet development tooling.
 * The faucet endpoint is publicly accessible (no JWT required)
 * but only active when STELLAR_NETWORK=testnet.
 *
 * Issue #1083: Testnet faucet integration.
 */
@Controller('stellar')
export class StellarController {
  constructor(private readonly faucetService: FaucetService) {}

  /**
   * POST /api/v1/stellar/faucet
   *
   * Fund a Stellar testnet account with 10,000 XLM via Friendbot.
   * Rate-limited to one request per address per 24 hours.
   * Only available when STELLAR_NETWORK=testnet.
   */
  @Public()
  @Post('faucet')
  @HttpCode(HttpStatus.OK)
  fundAccount(@Body() dto: FundAccountDto): Promise<FaucetFundResult> {
    return this.faucetService.fundAccount(dto.publicKey);
  }

  /**
   * GET /api/v1/stellar/faucet/status
   *
   * Returns whether the faucet endpoint is currently available.
   */
  @Public()
  @Get('faucet/status')
  getFaucetStatus(): { available: boolean; network: string } {
    return {
      available: this.faucetService.isAvailable,
      network: process.env.STELLAR_NETWORK || 'testnet',
    };
  }
}
