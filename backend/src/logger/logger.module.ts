import { Global, Module } from "@nestjs/common";
import { LoggerService } from "./logger.service";
import { LogsController } from "./logs.controller";
import { AlertingService } from "./alerting.service";
import { SlackService } from "./slack.service";
import { StatsSchedulerService } from "./stats-scheduler.service";
import { MonitoringService } from "./monitoring.service";
import { DashboardController } from "./dashboard.controller";
import { PrismaService } from "../prisma.service";
import { CorrelationIdContext } from "./correlation-id.context";

@Global()
@Module({
  controllers: [LogsController, DashboardController],
  providers: [
    LoggerService,
    AlertingService,
    SlackService,
    StatsSchedulerService,
    MonitoringService,
    PrismaService,
    CorrelationIdContext,
  ],
  exports: [LoggerService, AlertingService, SlackService, MonitoringService, CorrelationIdContext],
})
export class LoggerModule {}
