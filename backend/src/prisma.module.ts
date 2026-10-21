/**
 * PrismaModule — @Global singleton provider for PrismaService (#1024).
 *
 * Registering PrismaModule once in AppModule and marking it @Global means
 * every feature module that injects PrismaService receives the SAME instance.
 * Previously, individual modules each listed PrismaService in their own
 * `providers` array, which caused NestJS to instantiate a separate PrismaClient
 * per module — each opening its own connection pool and doubling (or worse) the
 * total number of connections opened against Postgres.
 *
 * With this module:
 *   - AppModule imports PrismaModule once.
 *   - All other modules simply inject PrismaService without declaring it as a
 *     provider. NestJS resolves it from the global scope automatically.
 *   - connection_limit=20 is enforced by a single PrismaClient instance, so
 *     the pool cap is respected across the entire application.
 *
 * Migration path for existing modules:
 *   Remove `PrismaService` from the `providers` array of every feature module.
 *   The injection token is still `PrismaService` — no import change needed in
 *   service constructors.
 */

import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports:   [PrismaService],
})
export class PrismaModule {}
