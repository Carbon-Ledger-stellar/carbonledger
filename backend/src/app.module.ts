import { AdminModule } from "./admin/admin.module";
import { PublicApiModule } from "./public-api/public-api.module";
import { Module, Controller, Get } from "@nestjs/common";
import { APP_INTERCEPTOR, APP_GUARD, APP_FILTER } from "@nestjs/core";
import { BullModule } from "@nestjs/bullmq";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
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

@Controller("health")
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  check() {
    return {
      status: "ok",
      stellar_network: process.env.STELLAR_NETWORK || "testnet",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("pool")
  pool() {
    return this.prisma.getPoolMetrics();
  }
}

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: "default", ttl: 60_000, limit: 60 },   // 60 req/min for most endpoints
      { name: "auth",    ttl: 60_000, limit: 5 },    // 5 req/min for login (brute-force protection)
      { name: "retire",  ttl: 60_000, limit: 10 },   // 10 req/min for retire (business flow protection)
    ]),
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
  ],
  controllers: [HealthController],
  providers: [
    PrismaService,
    {
      provide: APP_FILTER,
      useClass: ThrottlerExceptionFilter,
    },
    {
      provide: APP_FILTER,
      useClass: ResponseAlreadySentFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,  // Apply rate limiting globally
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
