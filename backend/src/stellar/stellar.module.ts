import { Module } from '@nestjs/common';
import { StellarController } from './stellar.controller';
import { FaucetService } from '../common/faucet.service';

/**
 * StellarModule — Stellar testnet utilities
 *
 * Provides the faucet endpoint for funding testnet accounts during
 * local development and staging.
 *
 * Issue #1083: Testnet faucet integration.
 */
@Module({
  controllers: [StellarController],
  providers: [FaucetService],
  exports: [FaucetService],
})
export class StellarModule {}
