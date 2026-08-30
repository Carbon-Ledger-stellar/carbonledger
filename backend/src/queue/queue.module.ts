import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { QueueProcessor } from './queue.processor';
import {
  EventIndexerService,
  SOROBAN_RPC_CLIENT,
  SorobanEventClient,
} from './event-indexer.service';
import { AuthModule } from '../auth/auth.module';
import { QUEUE_NAME } from './queue.constants';
import { PrismaService } from '../prisma.service';
import { RetirementsModule } from '../retirements/retirements.module';
import { CertificateProcessor } from '../certificates/certificate.processor';
import { CertificatesModule } from '../certificates/certificates.module';
import { CreditsModule } from '../credits/credits.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAME }),
    AuthModule,
    forwardRef(() => RetirementsModule),
    forwardRef(() => CreditsModule),
    CertificatesModule,
  ],
  providers: [
    QueueService,
    QueueProcessor,
    PrismaService,
    {
      provide: SOROBAN_RPC_CLIENT,
      useFactory: (): SorobanEventClient => {
        // stellar-sdk >= 12 exposes the RPC client via the ./rpc exports
        // subpath, which TS "node" moduleResolution cannot resolve statically.
        const { Server } = require('@stellar/stellar-sdk/rpc');
        return new Server(
          process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org',
        ) as unknown as SorobanEventClient;
      },
    },
    EventIndexerService,
  ],
  controllers: [QueueController],
  exports: [QueueService, EventIndexerService],
})
export class QueueModule implements OnModuleInit {
  constructor(private readonly certificateProcessor: CertificateProcessor) {}

  async onModuleInit() {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    // Start polling for pending certificates every 60 seconds
    setInterval(async () => {
      try {
        await this.certificateProcessor.pollPendingCertificates();
      } catch (error) {
        console.error('Certificate polling error:', error);
      }
    }, 60000); // 60 seconds

    // Run initial poll on startup
    try {
      await this.certificateProcessor.pollPendingCertificates();
    } catch (error) {
      console.error('Initial certificate poll failed:', error);
    }
  }
}
