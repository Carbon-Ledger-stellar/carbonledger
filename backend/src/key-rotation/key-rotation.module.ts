import { Module } from '@nestjs/common';
import { KeyRotationController } from './key-rotation.controller';
import { KeyRotationService } from './key-rotation.service';
import { PrismaService } from '../prisma.service';
import { SecretsManagerProvider } from './secrets-manager.provider';
import { SecretsRefreshService } from './secrets-refresh.service';

@Module({
  controllers: [KeyRotationController],
  providers: [
    // Existing — admin-triggered oracle/admin Stellar keypair rotation.
    // Unrelated to this change, left as-is.
    KeyRotationService,
    PrismaService,
    // New — AWS Secrets Manager-backed JWT / Postgres / Redis rotation.
    // Exported so AuthModule's JWTRotationStrategy and the Prisma/Redis
    // connection setup can inject SecretsRefreshService.
    SecretsManagerProvider,
    SecretsRefreshService,
  ],
  exports: [KeyRotationService, SecretsRefreshService],
})
export class KeyRotationModule {}
