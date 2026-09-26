/**
 * Blockchain Module
 * 
 * Provides the blockchain provider with dependency injection.
 * Uses the mock provider when NODE_ENV=test, otherwise the real provider.
 */

import { Module, Global } from '@nestjs/common';
import { IBlockchainProvider } from './interface';
import { SorobanBlockchainProvider } from './soroban.provider';
import { MockBlockchainProvider } from './mock.provider';

@Global()
@Module({
  providers: [
    {
      provide: 'IBlockchainProvider',
      useClass: process.env.NODE_ENV === 'test' || process.env.USE_MOCK_BLOCKCHAIN === 'true'
        ? MockBlockchainProvider
        : SorobanBlockchainProvider,
    },
    MockBlockchainProvider,
    SorobanBlockchainProvider,
  ],
  exports: ['IBlockchainProvider'],
})
export class BlockchainModule {}
