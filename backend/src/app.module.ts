import { AdminModule } from "./admin/admin.module";
import { PublicApiModule } from "./public-api/public-api.module";
import { Module, Controller, Get, MiddlewareConsumer, NestModule, RequestMethod } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_GUARD, APP_FILTER } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule } from "@nestjs/throttler";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { CreditsModule } from "./credits/credits.module";
import { RetirementsModule } from "./retirements/retirements.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { OracleModule } from "./oracle/oracle.module";
import { StatsModule } from "./stats/stats.module";
import { QueueModule } from "./queue/queue.module";
import { IndexerModule } from "./indexer/indexer.module";
import { UploadsModule } from "./uploads/uploads.module";
import { AuditModule } from "./audit/audit.module";
import { AuditInterceptor } from "./audit/audit.interceptor";
import { PrismaService } from "./prisma.service";
import { VerifiersModule } from "./verifiers/verifiers.module";
import { ThrottlerExceptionFilter, ResponseAlreadySentFilter } from "./common/throttler-exception.filter";
import { CustomThrottlerGuard } from "./common/custom-throttler.guard";
import { StellarNetworkService } from './common/stellar-network.service';
import { StellarUnavailableExceptionFilter } from './common/stellar-unavailable.filter';
import { LoggerModule } from "./logger/logger.module";
import { CorrelationIdMiddleware } from "./logger/correlation-id.middleware";
import { LoggingInterceptor } from "./logger/logging.interceptor";
// Role-based quota throttling (issue #540)
import { ThrottleModule, RoleLimitGuard } from "./throttle";
// Idempotency support for critical POST endpoints (issue #539)
import { IdempotencyModule } from "./idempotency/idempotency.module";
import { IdempotencyMiddleware } from "./idempotency/idempotency.middleware";

import { Res, HttpStatus } from "@nestjs/common";
import { Response } from "express";
import { Server } from "@stellar/stellar-sdk";
import { Redis } from "ioredis";

@Controller("health")
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res() res: Response) {
    const checks = {
      postgres: "down",
      redis: "down",
      stellar: "down",
    };
    let allUp = true;

    // Check Postgres
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = "up";
    } catch (e) {
      allUp = false;
    }

    // Check Redis
    try {
      const redis = new Redis(process.env.REDIS_URL ?? `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`);
      await redis.ping();
      redis.disconnect();
      checks.redis = "up";
    } catch (e) {
      allUp = false;
    }

    // Check Stellar
    try {
      const horizonUrl = process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
      const server = new Server(horizonUrl);
      await server.root();
      checks.stellar = "up";
    } catch (e) {
      allUp = false;
    }

    const payload = {
      status: allUp ? "ok" : "error",
      stellar_network: process.env.STELLAR_NETWORK || "testnet",
      timestamp: new Date().toISOString(),
      checks,
    };

    if (allUp) {
      return res.status(HttpStatus.OK).json(payload);
    } else {
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json(payload);
    }
  }

  @Get("pool")
  pool() {
    return this.prisma.getPoolMetrics();
  }
}

@Module({
  imports: [
    // Built-in NestJS throttler (IP-based, Redis-backed) — handles burst/DDoS at infra level
    ThrottlerModule.forRoot({
      throttlers: [
        { name: "default",       ttl: 60_000, limit: 60   },
        { name: "auth",          ttl: 60_000, limit: 5    },
        { name: "retire",        ttl: 60_000, limit: 10   },
        { name: "public",        ttl: 60_000, limit: 100  },
        { name: "authenticated", ttl: 60_000, limit: 1000 },
      ],
      storage: new ThrottlerStorageRedisService(
        process.env.REDIS_URL ?? `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`,
      ),
    }),
    // Role-based quota throttling: project=100 mint/day, corp=1000 purchase/day,
    // public=100 read/hr. Adaptive throttling reduces limits when CPU >80% for 5+ min.
    ThrottleModule,
    BullModule.forRoot({
      connection: process.env.REDIS_SENTINELS
        ? {
            sentinels: process.env.REDIS_SENTINELS.split(",").map((s) => {
              const [host, port] = s.split(":");
              return { host, port: parseInt(port || "26379") };
            }),
            name: process.env.REDIS_SENTINEL_NAME || "mymaster",
            password: process.env.REDIS_PASSWORD || undefined,
          }
        : {
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            password: process.env.REDIS_PASSWORD || undefined,
          },
    }),
    LoggerModule,
    AuthModule,
    ProjectsModule,
    CreditsModule,
    RetirementsModule,
    MarketplaceModule,
    OracleModule,
    StatsModule,
    QueueModule,
    UploadsModule,
    AuditModule,
    VerifiersModule,
    AdminModule,
    PublicApiModule,
    RedisModule,
    IdempotencyModule,
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    StellarNetworkService,
    {
      provide: APP_FILTER,
      useClass: ThrottlerExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: StellarUnavailableExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: ResponseAlreadySentFilter,
    },
    // IP-level throttler guard (NestJS built-in, Redis-backed)
    {
      provide: APP_GUARD,
      useClass: CustomThrottlerGuard,
    },
    // Role-based quota guard: enforces per-role daily/hourly limits
    {
      provide: APP_GUARD,
      useClass: RoleLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdMiddleware,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');

    // Apply idempotency enforcement to the three critical mutating endpoints.
    // The Idempotency-Key header is optional; omitting it simply bypasses the check.
    consumer
      .apply(IdempotencyMiddleware)
      .forRoutes(
        { path: 'credits/mint',           method: RequestMethod.POST },
        { path: 'marketplace/purchase',   method: RequestMethod.POST },
        { path: 'retirements',            method: RequestMethod.POST },
      );
  }
}
