import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./auth/auth.module";
import { ProjectsModule } from "./projects/projects.module";
import { CreditsModule } from "./credits/credits.module";
import { RetirementsModule } from "./retirements/retirements.module";
import { MarketplaceModule } from "./marketplace/marketplace.module";
import { OracleModule } from "./oracle/oracle.module";
import { StatsModule } from "./stats/stats.module";
import { PrismaService } from "./prisma.service";
import { ThrottleModule, RoleLimitGuard } from "./throttle";
import { EventSourcingModule } from "./events/event-sourcing.module";

@Module({
  imports: [
    ThrottleModule,
    EventSourcingModule,
    AuthModule,
    ProjectsModule,
    CreditsModule,
    RetirementsModule,
    MarketplaceModule,
    OracleModule,
    StatsModule,
  ],
  providers: [
    PrismaService,
    // Apply RoleLimitGuard globally — every route is throttled by default.
    // Use @SkipThrottle() on a handler to opt out.
    {
      provide: APP_GUARD,
      useClass: RoleLimitGuard,
    },
  ],
})
export class AppModule {}
